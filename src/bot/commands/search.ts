/**
 * Search Command
 * Search for Bilibili videos by keyword
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import EmbedBuilders = require('../../ui/embeds');
import ButtonBuilders = require('../../ui/buttons');
import * as logger from '../../services/logger_service';

const createSearchCommand = (playbackService: any) => ({
  data: new SlashCommandBuilder()
    .setName('search')
    .setDescription('搜索 Bilibili 视频')
    .addStringOption((option) =>
      option
        .setName('keyword')
        .setDescription('搜索关键词')
        .setRequired(true),
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
      const maxResults = interaction.options.getInteger('results') ?? 5;
      const user       = interaction.user;

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      deferred = true;

      const extractor = playbackService.getExtractor();
      if (!extractor) {
        const errEmbed = EmbedBuilders.createErrorEmbed(
          'Extractor Not Ready',
          '音频提取器未初始化，请稍后再试。',
        );
        await interaction.editReply({ embeds: [errEmbed] });
        return;
      }

      // extractor.searchVideos may return a plain array or { success, results }
      const response = await extractor.searchVideos(keyword, maxResults) as any;
      const results: any[] = Array.isArray(response) ? response : (response?.results ?? []);

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
        components = [ButtonBuilders.createSearchResultsMenu(results, keyword)];
      } catch { /* StringSelectMenuBuilder unavailable — reply with embeds only */ }

      const payload: Record<string, unknown> = { embeds: [searchEmbed] };
      if (components.length > 0) payload.components = components;

      await interaction.editReply(payload);

      logger.info('Search command executed', {
        user: user.username,
        guild: interaction.guild.name,
        keyword,
        resultsFound: results.length,
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
