/**
 * Play Command
 * Plays audio from a Bilibili or YouTube video URL, or keyword search.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { routeQuery } from '../../utils/url_router';
import SearchResultsView = require('../../ui/search_results_view');
import SearchService = require('../../search/search_service');
import SearchSessionStore = require('../../search/search_session_store');
import BilibiliUrls = require('../../search/bilibili_urls');
import YouTubeUrls = require('../../search/youtube_urls');
import PlaybackCoordinator = require('../../playback/playback_coordinator');
import { createInteractionStageReporter } from '../../playback/stage_feedback';
import * as logger from '../../services/logger_service';
import config = require('../../config/config');
import { interleaveRoundRobin } from '../../search/interleave';
import BilibiliApi = require('../../bilibili/api');

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

      if (!query?.trim()) {
        await interaction.reply({
          content: '请提供视频链接或搜索关键词',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const route = routeQuery(query);

      if (route.kind === 'youtube-video') {
        const ytExtractor = playbackService.getYouTubeExtractor();
        if (!ytExtractor) {
          await interaction.editReply({ content: '[!] YouTube support is not available' });
          return;
        }

        const stageReporter = createInteractionStageReporter(interaction, 'YouTube');
        const result = await PlaybackCoordinator.playUrl('youtube', {
          interaction,
          playerService: playbackService,
          url:           route.normalizedUrl || route.raw,
          onStage:       stageReporter,
        });
        await stageReporter.finish();
        if (!result.success) {
          const msg = result.error || '';
          const lowerMsg = msg.toLowerCase();
          if (lowerMsg.includes('auth/bot check') || lowerMsg.includes('automatic cookie refresh') || lowerMsg.includes('cookies expired')) {
            await interaction.editReply({
              content: '[✗] YouTube auth check failed after automatic cookie refresh. The bot account may need a fresh VPS browser login.',
            });
          } else if (msg.includes('unavailable') || msg.includes('private')) {
            await interaction.editReply({ content: '[!] Video is unavailable or private' });
          } else if (msg.includes('Age-restricted')) {
            await interaction.editReply({ content: '[!] Age-restricted video (login required)' });
          } else {
            await interaction.editReply({ content: `[!] YouTube extraction failed: ${msg.substring(0, 100)}` });
          }
          logger.error('YouTube extraction failed in play command', {
            url: route.normalizedUrl,
            error: msg,
            user: user.username,
          });
          return;
        }

        const trackTitle = (result.track as { title?: string } | undefined)?.title;
        await interaction.editReply({ content: `>> Added: ${trackTitle || route.raw}` });
        logger.info('Play command completed (YouTube)', {
          query,
          url: route.normalizedUrl,
          title: trackTitle,
          user: user.username,
        });
        return;
      }

      if (route.kind === 'bilibili-video') {
        const url = route.normalizedUrl || route.raw;

        const stageReporter = createInteractionStageReporter(interaction, 'Bilibili');
        const result = await PlaybackCoordinator.playUrl('bilibili', {
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
        await interaction.editReply({ content: `>> 已添加: ${trackTitle || url}` });
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
          content: '[!] 不支持的链接格式。请使用 Bilibili 或 YouTube 单视频链接；不支持歌单、收藏夹、合集或音频附件。',
        });
        return;
      }

      // ─── Keyword search (Bilibili + YouTube) ─────────────────────────────────
      await interaction.editReply({ content: `[?] Searching "${query}" on Bilibili & YouTube...` });

      const ytExtractorForSearch = playbackService.getYouTubeExtractor();
      const perPlatformLimit = config.search.limitPerPlatform;

      const searchResult = await SearchService.searchDualPlatforms({
        keyword:          query as string,
        limitPerPlatform: perPlatformLimit,
        bilibiliApi: BilibiliApi,
        youtubeExtractor: ytExtractorForSearch,
      });
      const biliResults = searchResult.bilibili;
      const ytResults    = searchResult.youtube;

      if (biliResults.length === 0 && ytResults.length === 0) {
        await interaction.editReply({ content: `No results found for "${query}"` });
        return;
      }

      // Per-platform entries, round-robin interleaved into one numbered list
      // (bili1, yt1, bili2, yt2, ...) and paginated by the shared search
      // results view. Cap at 30 total; the per-page select menu removes any
      // need for a 25-entry cap (Discord's select-option limit).
      const biliEntries = SearchResultsView.createSessionEntries(biliResults as any[], 'bilibili');
      const ytEntries   = SearchResultsView.createSessionEntries(ytResults as any[], 'youtube', biliEntries.length);
      const interleavedEntries = interleaveRoundRobin([biliEntries, ytEntries]).slice(0, 30);

      const session = {
        keyword: query as string,
        mode: 'mixed' as const,
        entries: interleavedEntries,
      };
      const token = SearchSessionStore.create(session);

      // Clear the "Searching..." text so only the results embed remains.
      await interaction.editReply({
        content: null,
        ...SearchResultsView.buildSearchResultsMessage(token, { ...session, currentPage: 1 }),
      });

      // Only prewarm the first page's worth per platform; the rest may never
      // be viewed.
      playbackService.prewarmBilibiliUrls?.(
        BilibiliUrls.collectBilibiliUrls(biliResults, SearchResultsView.RESULTS_PER_PAGE),
        {
          source: 'play_search',
          guildId: interaction.guild.id,
          keyword: query as string,
        },
      );
      playbackService.prewarmYouTubeUrls?.(
        YouTubeUrls.collectYouTubeUrls(ytResults, SearchResultsView.RESULTS_PER_PAGE),
        {
          source: 'play_search',
          guildId: interaction.guild.id,
          keyword: query as string,
        },
      );

      logger.info('Play keyword search: showing interleaved dual-platform results', {
        query,
        biliCount:    biliResults.length,
        ytCount:      ytResults.length,
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
