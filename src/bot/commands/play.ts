/**
 * Play Command
 * Plays audio from a Bilibili video URL or keyword search
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import UrlValidator = require('../../bilibili/validator');
import * as logger from '../../services/logger_service';

const createPlayCommand = (playbackService: any, queueService: any) => ({
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('播放 Bilibili 视频（链接或关键词搜索）')
    .addStringOption((option) =>
      option
        .setName('query')
        .setDescription('Bilibili 视频链接或搜索关键词')
        .setRequired(true),
    ),

  cooldown: 5,

  async execute(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
    try {
      const query  = interaction.options.getString('query') || interaction.options.getString('url');
      const user   = interaction.user;
      const member = interaction.member;

      if (!member.voice.channel) {
        await interaction.reply({ content: 'Voice channel required', flags: MessageFlags.Ephemeral });
        return;
      }

      const botVoiceChannel = interaction.guild.members.me?.voice?.channel;
      if (botVoiceChannel && botVoiceChannel.id !== member.voice.channel.id) {
        await interaction.reply({
          content: `Bot is already playing in <#${botVoiceChannel.id}>`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      let url: string;
      if (UrlValidator.isValidBilibiliUrl(query as string)) {
        url = query as string;
      } else {
        await interaction.editReply({ content: `🔍 搜索 "${query}"...` });

        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const bilibiliApi = require('../../bilibili/api') as any;
        const results = await bilibiliApi.searchVideos(query, 1, 5) as any[];

        if (!results || results.length === 0) {
          await interaction.editReply({ content: `未找到 "${query}" 相关视频` });
          return;
        }

        url = results[0].url as string;
        logger.info('Keyword search resolved to URL', {
          keyword: query,
          resolvedUrl: url,
          title: results[0].title,
        });
      }

      const player = playbackService.getPlayer(interaction.guild.id);
      const joined = await player.joinVoiceChannel(member.voice.channel) as boolean;
      if (!joined) {
        await interaction.editReply({ content: 'Failed to join voice' });
        return;
      }

      const track = await queueService.addTrack(interaction.guild.id, url, `<@${user.id}>`);
      if (!track) {
        await interaction.editReply({ content: 'Add failed' });
        return;
      }

      playbackService.setUIContext(interaction.guild.id, interaction.channelId);
      if (!player.isPlaying && !player.isPaused) {
        await playbackService.play(interaction.guild.id);
      } else {
        // Already playing: addTrack() doesn't emit a state event, so the play
        // card queue count stays stale until the next progress-tracker tick.
        // Push the updated state immediately so the card reflects the new total.
        playbackService.notifyState(interaction.guild.id);
      }

      await interaction.editReply({ content: `🎵 已添加: ${track.title || url}` });

      logger.info('Play command completed', {
        query,
        url,
        title: track.title,
        user: user.username,
      });
    } catch (e: unknown) {
      logger.error('Play command failed', {
        query: interaction.options.getString('query'),
        user: interaction.user.username,
        error: (e as Error).message,
        stack: (e as Error).stack,
      });
      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.editReply({ content: 'Play failed' });
        } else {
          await interaction.reply({ content: 'Play failed', flags: MessageFlags.Ephemeral });
        }
      } catch { /* best effort */ }
    }
  },
});

export = createPlayCommand;
