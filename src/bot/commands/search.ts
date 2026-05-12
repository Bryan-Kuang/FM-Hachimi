/**
 * Search Command
 * Search for Bilibili or YouTube videos by keyword
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import EmbedBuilders = require('../../ui/embeds');
import ButtonBuilders = require('../../ui/buttons');
import SearchService = require('../../search/search_service');
import BilibiliUrls = require('../../search/bilibili_urls');
import * as logger from '../../services/logger_service';

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
    )
    .addIntegerOption((option) =>
      option
        .setName('results')
        .setDescription('显示结果数量（1-10）')
        .setMinValue(1)
        .setMaxValue(10)
        .setRequired(false),
    ),

  cooldown: 5,

  async execute(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
    let deferred = false;
    try {
      const keyword    = interaction.options.getString('keyword', true);
      const platform   = interaction.options.getString('platform') || 'bilibili';
      const maxResults = interaction.options.getInteger('results') ?? 5;
      const user       = interaction.user;

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
          limit: maxResults,
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

        const searchEmbed = EmbedBuilders.createSearchResultsEmbed(results, keyword);
        let components: any[] = [];
        try {
          components = [ButtonBuilders.createSearchResultsMenu(results, keyword, 'youtube')];
        } catch { /* StringSelectMenuBuilder unavailable */ }

        const payload: Record<string, unknown> = { embeds: [searchEmbed] };
        if (components.length > 0) payload.components = components;
        await interaction.editReply(payload);

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
        limit: maxResults,
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

      const searchEmbed = EmbedBuilders.createSearchResultsEmbed(results, keyword);

      // Build the select menu; may not be available in all runtime environments
      let components: any[] = [];
      try {
        components = [ButtonBuilders.createSearchResultsMenu(results, keyword, 'bilibili')];
      } catch { /* StringSelectMenuBuilder unavailable — reply with embeds only */ }

      const payload: Record<string, unknown> = { embeds: [searchEmbed] };
      if (components.length > 0) payload.components = components;

      await interaction.editReply(payload);
      playbackService.prewarmBilibiliUrls?.(
        BilibiliUrls.collectBilibiliUrls(results, maxResults),
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
