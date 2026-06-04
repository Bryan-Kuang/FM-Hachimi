/**
 * /ytfast — experimental, test-server-only YouTube playback.
 *
 * Uses the cookie-less "fast pass" extraction (android_vr/android player
 * clients, ~4-5s) instead of the standard cookie web client (~24s), falling
 * back to the cookie path for restricted videos. Marked stage:'testing' so it
 * only deploys to / runs in the test guild (see DEPLOY_TEST_COMMANDS + the
 * assertTestingGuild runtime guard).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { routeQuery } from '../../utils/url_router';
import PlaybackCoordinator = require('../../playback/playback_coordinator');
import { createInteractionStageReporter } from '../../playback/stage_feedback';
import * as logger from '../../services/logger_service';

const createYtFastCommand = (playbackService: any, _queueService?: any) => ({
  data: new SlashCommandBuilder()
    .setName('ytfast')
    .setDescription('Experimental fast YouTube playback (cookie-less extraction)')
    .addStringOption((option) =>
      option
        .setName('url')
        .setDescription('YouTube video link')
        .setRequired(true),
    ),

  stage: 'testing' as const,
  featureName: 'Fast YouTube',
  cooldown: 5,

  async execute(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
    try {
      const query  = interaction.options.getString('url', true);
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

      const route = routeQuery(query);
      if (route.platform !== 'youtube' || !route.isUrl) {
        await interaction.reply({
          content: '⚠️ /ytfast only accepts a YouTube video link.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (!playbackService.getYouTubeExtractor?.()) {
        await interaction.reply({ content: '⚠️ YouTube support is not available', flags: MessageFlags.Ephemeral });
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const stageReporter = createInteractionStageReporter(interaction, 'YouTube (fast)');
      const result = await PlaybackCoordinator.playYouTubeUrlFast({
        interaction,
        playerService: playbackService,
        url:           route.normalizedUrl || route.raw,
        onStage:       stageReporter,
      });
      await stageReporter.finish();

      if (!result.success) {
        await interaction.editReply({
          content: `⚠️ Fast playback failed: ${(result.error || 'unknown error').substring(0, 150)}`,
        });
        return;
      }

      const trackTitle = (result.track as { title?: string } | undefined)?.title;
      await interaction.editReply({ content: `⚡ Added (fast): ${trackTitle || route.raw}` });
      logger.info('ytfast command completed', {
        url: route.normalizedUrl,
        title: trackTitle,
        user: interaction.user.username,
      });
    } catch (e: unknown) {
      logger.error('ytfast command failed', {
        error: (e as Error).message,
        stack: (e as Error).stack,
      });
      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.editReply({ content: 'Fast playback failed' });
        } else {
          await interaction.reply({ content: 'Fast playback failed', flags: MessageFlags.Ephemeral });
        }
      } catch { /* best effort */ }
    }
  },
});

export = createYtFastCommand;
