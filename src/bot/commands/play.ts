/**
 * Play Command
 * Plays audio from a Bilibili or YouTube video URL, or keyword search.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { routeQuery } from '../../utils/url_router';
import EmbedBuilders = require('../../ui/embeds');
import ButtonBuilders = require('../../ui/buttons');
import SearchService = require('../../search/search_service');
import BilibiliUrls = require('../../search/bilibili_urls');
import PlaybackCoordinator = require('../../playback/playback_coordinator');
import { createInteractionStageReporter } from '../../playback/stage_feedback';
import * as logger from '../../services/logger_service';

const createPlayCommand = (playbackService: any, _queueService: any) => ({
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

        const result = await PlaybackCoordinator.playYouTubeUrl({
          interaction,
          playerService: playbackService,
          url:           route.normalizedUrl || route.raw,
        });
        if (!result.success) {
          const msg = result.error || '';
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

        const trackTitle = (result.track as { title?: string } | undefined)?.title;
        await interaction.editReply({ content: `🎵 Added: ${trackTitle || route.raw}` });
        logger.info('Play command completed (YouTube)', {
          query,
          url: route.normalizedUrl,
          title: trackTitle,
          user: user.username,
        });
        return;
      }

      // ─── Bilibili URL ───────────────────────────────────────────────────────
      if (route.platform === 'bilibili' && route.isUrl) {
        const url = route.normalizedUrl || route.raw;
        const stageReporter = createInteractionStageReporter(interaction, 'Bilibili');
        const result = await PlaybackCoordinator.playBilibiliUrl({
          interaction,
          playerService: playbackService,
          url,
          onStage: stageReporter,
        });
        await stageReporter.finish();
        if (!result.success) {
          await interaction.editReply({ content: result.error || 'Add failed' });
          return;
        }

        const trackTitle = (result.track as { title?: string } | undefined)?.title;
        await interaction.editReply({ content: `🎵 已添加: ${trackTitle || url}` });
        logger.info('Play command completed (Bilibili)', {
          query,
          url,
          title: trackTitle,
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
      const perPlatformLimit = 5;

      // Bilibili uses the HTTP API here so initial discovery stays fast.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const bilibiliApi = require('../../bilibili/api') as any;

      const searchResult = await SearchService.searchDualPlatforms({
        keyword:          query as string,
        limitPerPlatform: perPlatformLimit,
        bilibiliApi,
        youtubeExtractor: ytExtractorForSearch,
      });
      const biliResults = searchResult.bilibili;
      const ytResults   = searchResult.youtube;

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

      playbackService.prewarmBilibiliUrls?.(
        BilibiliUrls.collectBilibiliUrls(biliResults, perPlatformLimit),
        {
          source: 'play_search',
          guildId: interaction.guild.id,
          keyword: query as string,
        },
      );

      logger.info('Play keyword search: showing dual results', {
        query,
        biliCount: biliResults.length,
        ytCount: ytResults.length,
        rawBiliCount: searchResult.rawBilibiliCount,
        rawYtCount:   searchResult.rawYouTubeCount,
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
