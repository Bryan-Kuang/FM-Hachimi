/**
 * Search Command
 * Search for Bilibili or YouTube videos by keyword
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import EmbedBuilders = require('../../ui/embeds');
import SearchResultsView = require('../../ui/search_results_view');
import SearchService = require('../../search/search_service');
import SearchSessionStore = require('../../search/search_session_store');
import BilibiliUrls = require('../../search/bilibili_urls');
import YouTubeUrls = require('../../search/youtube_urls');
import * as logger from '../../services/logger_service';

// Fetched once per search and paginated client-side via the session store.
const TOTAL_RESULTS = 25;

const createSearchCommand = (playbackService: any) => ({
  data: new SlashCommandBuilder()
    .setName('search')
    .setDescription('搜索 Bilibili / YouTube 视频')
    .addStringOption((option) =>
      option
        .setName('keyword')
        .setDescription('搜索关键词')
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('platform')
        .setDescription('搜索平台（默认 bilibili）')
        .setRequired(false)
        .addChoices(
          { name: 'Bilibili', value: 'bilibili' },
          { name: 'YouTube', value: 'youtube' },
        ),
    ),

  cooldown: 5,

  async execute(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
    let deferred = false;
    try {
      const keyword  = interaction.options.getString('keyword', true);
      const platform = interaction.options.getString('platform') || 'bilibili';
      const user     = interaction.user;

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      deferred = true;

      // ─── YouTube search ───────────────────────────────────────────────────
      if (platform === 'youtube') {
        const ytExtractor = playbackService.getYouTubeExtractor();
        if (!ytExtractor) {
          const errEmbed = EmbedBuilders.createErrorEmbed(
            'YouTube Not Available',
            'YouTube 提取器未初始化，请稍后再试。',
          );
          await interaction.editReply({ embeds: [errEmbed] });
          return;
        }

        const results = await SearchService.searchYouTube({
          keyword,
          limit: TOTAL_RESULTS,
          youtubeExtractor: ytExtractor,
        });

        if (results.length === 0) {
          const noResultsEmbed = EmbedBuilders.createErrorEmbed(
            'No Results Found',
            `未找到 "${keyword}" 相关 YouTube 视频。`,
          );
          await interaction.editReply({ embeds: [noResultsEmbed] });
          return;
        }

        const session = {
          keyword,
          mode: 'youtube' as const,
          entries: SearchResultsView.createSessionEntries(results as any[], 'youtube'),
        };
        const token = SearchSessionStore.create(session);
        await interaction.editReply(
          SearchResultsView.buildSearchResultsMessage(token, { ...session, currentPage: 1 }),
        );

        // Only prewarm the first page; the rest may never be viewed.
        playbackService.prewarmYouTubeUrls?.(
          YouTubeUrls.collectYouTubeUrls(results, SearchResultsView.RESULTS_PER_PAGE),
          {
            source: 'search_command',
            guildId: interaction.guildId || interaction.guild?.id,
            keyword,
          },
        );

        logger.info('Search command executed (YouTube)', {
          user: user.username,
          guild: interaction.guild.name,
          keyword,
          resultsFound: results.length,
          rawResultsFound: results.length,
        });
        return;
      }

      // ─── Bilibili search (default) ────────────────────────────────────────
      const extractor = playbackService.getExtractor();
      if (!extractor) {
        const errEmbed = EmbedBuilders.createErrorEmbed(
          'Extractor Not Ready',
          '音频提取器未初始化，请稍后再试。',
        );
        await interaction.editReply({ embeds: [errEmbed] });
        return;
      }

      const results = await SearchService.searchBilibili({
        keyword,
        limit: TOTAL_RESULTS,
        extractor,
      });

      if (results.length === 0) {
        const noResultsEmbed = EmbedBuilders.createErrorEmbed(
          'No Results Found',
          `未找到 "${keyword}" 相关视频。`,
        );
        await interaction.editReply({ embeds: [noResultsEmbed] });
        return;
      }

      const session = {
        keyword,
        mode: 'bilibili' as const,
        entries: SearchResultsView.createSessionEntries(results as any[], 'bilibili'),
      };
      const token = SearchSessionStore.create(session);
      await interaction.editReply(
        SearchResultsView.buildSearchResultsMessage(token, { ...session, currentPage: 1 }),
      );

      // Only prewarm the first page; the rest may never be viewed.
      playbackService.prewarmBilibiliUrls?.(
        BilibiliUrls.collectBilibiliUrls(results, SearchResultsView.RESULTS_PER_PAGE),
        {
          source: 'search_command',
          guildId: interaction.guildId || interaction.guild?.id,
          keyword,
        },
      );

      logger.info('Search command executed', {
        user: user.username,
        guild: interaction.guild.name,
        keyword,
        resultsFound: results.length,
        rawResultsFound: results.length,
      });
    } catch (e: unknown) {
      logger.error('Search command failed', {
        user: interaction.user.username,
        error: (e as Error).message,
      });
      try {
        if (deferred) {
          await interaction.editReply({ content: 'Search failed' });
        } else {
          await interaction.reply({ content: 'Search failed', flags: MessageFlags.Ephemeral });
        }
      } catch { /* best effort */ }
    }
  },
});

export = createSearchCommand;
