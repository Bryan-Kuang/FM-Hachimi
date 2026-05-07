/**
 * Play Command
 * Plays audio from a Bilibili or YouTube video URL, or keyword search.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { routeQuery } from '../../utils/url_router';
import EmbedBuilders = require('../../ui/embeds');
import ButtonBuilders = require('../../ui/buttons');
import * as logger from '../../services/logger_service';

const createPlayCommand = (playbackService: any, queueService: any) => ({
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('播放 Bilibili / YouTube 视频（链接或关键词搜索）')
    .addStringOption((option) =>
      option
        .setName('query')
        .setDescription('视频链接或搜索关键词（支持 Bilibili / YouTube）')
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

      const route = routeQuery(query as string);

      // ─── YouTube URL ────────────────────────────────────────────────────────
      if (route.platform === 'youtube' && route.isUrl) {
        const ytExtractor = playbackService.getYouTubeExtractor();
        if (!ytExtractor) {
          await interaction.editReply({ content: '⚠️ YouTube support is not available' });
          return;
        }

        await interaction.editReply({ content: '🎬 Extracting YouTube audio...' });

        let videoData;
        try {
          videoData = await ytExtractor.extractAudio(route.normalizedUrl || route.raw);
        } catch (ytErr: unknown) {
          const msg = (ytErr as Error).message || '';
          if (msg.includes('cookies expired')) {
            await interaction.editReply({
              content: '🔒 YouTube cookies expired. Ask the bot admin to run `bash scripts/refresh-cookies.sh`',
            });
          } else if (msg.includes('unavailable') || msg.includes('private')) {
            await interaction.editReply({ content: '⚠️ Video is unavailable or private' });
          } else if (msg.includes('Age-restricted')) {
            await interaction.editReply({ content: '⚠️ Age-restricted video (login required)' });
          } else {
            await interaction.editReply({ content: `⚠️ YouTube extraction failed: ${msg.substring(0, 100)}` });
          }
          logger.error('YouTube extraction failed in play command', {
            url: route.normalizedUrl,
            error: msg,
            user: user.username,
          });
          return;
        }

        const player = playbackService.getPlayer(interaction.guild.id);
        const joined = await player.joinVoiceChannel(member.voice.channel) as boolean;
        if (!joined) {
          await interaction.editReply({ content: 'Failed to join voice' });
          return;
        }

        const track = await queueService.addTrack(interaction.guild.id, videoData, `<@${user.id}>`);
        if (!track) {
          await interaction.editReply({ content: 'Add failed' });
          return;
        }

        playbackService.setUIContext(interaction.guild.id, interaction.channelId);
        if (!player.isPlaying && !player.isPaused) {
          await playbackService.play(interaction.guild.id);
        } else {
          playbackService.notifyState(interaction.guild.id);
        }

        await interaction.editReply({ content: `🎵 Added: ${track.title || route.raw}` });
        logger.info('Play command completed (YouTube)', {
          query,
          url: route.normalizedUrl,
          title: track.title,
          user: user.username,
        });
        return;
      }

      // ─── Bilibili URL ───────────────────────────────────────────────────────
      if (route.platform === 'bilibili' && route.isUrl) {
        const url = route.normalizedUrl || route.raw;
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
          playbackService.notifyState(interaction.guild.id);
        }

        await interaction.editReply({ content: `🎵 已添加: ${track.title || url}` });
        logger.info('Play command completed (Bilibili)', {
          query,
          url,
          title: track.title,
          user: user.username,
        });
        return;
      }

      // ─── Unsupported URL ────────────────────────────────────────────────────
      if (route.isUrl && route.platform === 'unknown') {
        await interaction.editReply({
          content: '⚠️ 不支持的链接格式。目前支持 Bilibili 和 YouTube 链接。',
        });
        return;
      }

      // ─── Keyword search (Bilibili + YouTube) ─────────────────────────────────
      await interaction.editReply({ content: `🔍 Searching "${query}" on Bilibili & YouTube...` });

      const ytExtractorForSearch = playbackService.getYouTubeExtractor();
      const biliExtractor = playbackService.getExtractor();

      // Search both platforms in parallel
      const [biliResponse, ytResponse] = await Promise.allSettled([
        biliExtractor
          ? biliExtractor.searchVideos(query as string, 3)
          : Promise.resolve({ success: false, results: [] }),
        ytExtractorForSearch
          ? ytExtractorForSearch.searchVideos(query as string, 3)
          : Promise.resolve({ success: false, results: [] }),
      ]);

      const biliResults: any[] = biliResponse.status === 'fulfilled'
        ? (Array.isArray(biliResponse.value) ? biliResponse.value : (biliResponse.value as any)?.results ?? [])
        : [];
      const ytResults: any[] = ytResponse.status === 'fulfilled'
        ? ((ytResponse.value as any)?.results ?? [])
        : [];

      if (biliResults.length === 0 && ytResults.length === 0) {
        await interaction.editReply({ content: `No results found for "${query}"` });
        return;
      }

      const searchEmbed = EmbedBuilders.createDualSearchEmbed(biliResults, ytResults, query as string);
      let components: any[] = [];
      try {
        components = [ButtonBuilders.createDualSearchMenu(biliResults, ytResults, query as string)];
      } catch { /* select menu unavailable */ }

      const payload: Record<string, unknown> = { embeds: [searchEmbed] };
      if (components.length > 0) payload.components = components;
      await interaction.editReply(payload);

      logger.info('Play keyword search: showing dual results', {
        query,
        biliCount: biliResults.length,
        ytCount: ytResults.length,
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
