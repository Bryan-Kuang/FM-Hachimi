/**
 * Status Command
 * Health check without SSH: uptime, deployed version, voice sessions,
 * media-cache usage, and cookie freshness in one ephemeral embed.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, MessageFlags } from 'discord.js';
import fs from 'fs';
import path from 'path';
import config = require('../../config/config');
import * as logger from '../../services/logger_service';

interface CacheStats {
  entries: number;
  bytes: number;
}

function readCacheStats(dir: string): CacheStats | null {
  try {
    const raw = fs.readFileSync(path.join(dir, 'index.json'), 'utf8');
    const index = JSON.parse(raw) as Record<string, { bytes?: number }>;
    const values = Object.values(index);
    return {
      entries: values.length,
      bytes: values.reduce((sum, entry) => sum + (entry.bytes || 0), 0),
    };
  } catch {
    return null;
  }
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

function formatDuration(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function cookieAge(file: string): string {
  try {
    const ageMs = Date.now() - fs.statSync(file).mtimeMs;
    return `${formatDuration(ageMs / 1000)} ago`;
  } catch {
    return 'missing';
  }
}

const createStatusCommand = (playerService: any) => ({
  data: new SlashCommandBuilder()
    .setName('status')
    .setDescription('机器人健康状态：运行时间、版本、会话与缓存'),

  cooldown: 5,

  async execute(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
    try {
      const gitSha = (process.env.GIT_SHA || '').slice(0, 7) || 'dev';
      const stats = playerService.getStatistics?.() ?? null;
      const bilibiliCache = readCacheStats(config.bilibili.mediaCacheDir);
      const youtubeCache = readCacheStats(config.youtube.mediaCacheDir);

      const cacheLine = (label: string, s: CacheStats | null): string =>
        s ? `${label}: ${s.entries} tracks, ${formatBytes(s.bytes)}` : `${label}: n/a`;

      const embed = new EmbedBuilder()
        .setTitle('🩺 Bot Status')
        .setColor(0x57f287)
        .addFields(
          { name: 'Uptime', value: formatDuration(process.uptime()), inline: true },
          { name: 'Version', value: `\`${gitSha}\``, inline: true },
          {
            name: 'Voice sessions',
            value: stats
              ? `${stats.activeConnections} connected, ${stats.playingGuilds} playing, ${stats.totalTracks} queued`
              : 'n/a',
            inline: false,
          },
          {
            name: 'Media cache',
            value: [
              cacheLine('Bilibili', bilibiliCache),
              cacheLine('YouTube', youtubeCache),
            ].join('\n'),
            inline: false,
          },
          {
            name: 'Cookies (last refresh)',
            value: [
              `Bilibili: ${cookieAge(config.bilibili.cookiesFile)}`,
              `YouTube: ${cookieAge(config.youtube.cookieRefresh.cookiesFile)}`,
            ].join('\n'),
            inline: false,
          },
        )
        .setTimestamp();

      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });

      logger.info('Status command executed', {
        user: interaction.user.username,
        guild: interaction.guild.name,
      });
    } catch (e: unknown) {
      logger.error('Status command failed', {
        user: interaction.user.username,
        error: (e as Error).message,
      });
      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.editReply({ content: 'Status command failed' });
        } else {
          await interaction.reply({ content: 'Status command failed', flags: MessageFlags.Ephemeral });
        }
      } catch { /* best effort */ }
    }
  },
});

export = createStatusCommand;
