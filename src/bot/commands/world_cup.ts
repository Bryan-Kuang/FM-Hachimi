/**
 * /worldcup command
 * Live World Cup scores. Server admins subscribe a channel for automatic
 * kickoff/goal/full-time pushes; anyone can pull today's fixtures + scores on
 * demand. The on-demand subcommands are a reliable fallback when the live
 * updater is degraded (see /worldcup status).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  MessageFlags,
  EmbedBuilder,
  ChatInputCommandInteraction,
} from 'discord.js';
import * as logger from '../../services/logger_service';
import WcEmbeds = require('../../world_cup/embeds');

const WC_COLOR = 0x326295;

const createWorldCupCommand = (
  _playbackService: any,
  _queueService: any,
  _dailyHachimiService: any,
  worldCupService: any,
) => ({
  data: new SlashCommandBuilder()
    .setName('worldcup')
    .setDescription('2026 世界杯 — 实时比分与赛程')
    .addSubcommand((sub) =>
      sub
        .setName('subscribe')
        .setDescription('将比赛实时更新推送到指定频道（需要管理服务器权限）')
        .addChannelOption((opt) =>
          opt
            .setName('channel')
            .setDescription('接收开球 / 进球 / 完场更新的文字频道')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName('unsubscribe').setDescription('关闭本服务器的实时更新（需要管理服务器权限）'),
    )
    .addSubcommand((sub) =>
      sub.setName('today').setDescription('查看今天的赛程与比分'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('schedule')
        .setDescription('查看指定日期的赛程与比分')
        .addStringOption((opt) =>
          opt.setName('date').setDescription('日期，格式 YYYY-MM-DD（默认今天，UTC 时区）').setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName('status').setDescription('查看订阅状态与实时更新健康状况'),
    ),

  async execute(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
    const sub = interaction.options.getSubcommand();

    if (!worldCupService) {
      await interaction.reply({ content: '[i] The World Cup feature is not enabled.', flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'subscribe' || sub === 'unsubscribe') {
      if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
        await interaction.reply({
          content: '[✗] You need the **Manage Server** permission to use this.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      if (sub === 'subscribe') await handleSubscribe(interaction, worldCupService);
      else if (sub === 'unsubscribe') await handleUnsubscribe(interaction, worldCupService);
      else if (sub === 'status') await handleStatus(interaction, worldCupService);
      else await handleMatches(interaction, worldCupService, sub);
    } catch (err: unknown) {
      const e = err as Error;
      logger.error('/worldcup command error', {
        sub,
        guild: interaction.guild?.id,
        user: interaction.user?.username,
        error: e.message,
        stack: e.stack,
      });
      await interaction.editReply({ content: `[✗] Something went wrong: ${e.message}` });
    }
  },
});

// ---------------------------------------------------------------------------
// Subcommand handlers
// ---------------------------------------------------------------------------

async function handleSubscribe(
  interaction: ChatInputCommandInteraction<'cached'>,
  service: any,
): Promise<void> {
  const channel = interaction.options.getChannel('channel', true);

  const botMember = interaction.guild.members.me;
  if (botMember && 'permissionsFor' in channel) {
    const perms = (channel as any).permissionsFor?.(botMember);
    if (perms && !perms.has(['SendMessages', 'EmbedLinks'])) {
      await interaction.editReply({
        content: `[✗] I need **Send Messages** and **Embed Links** in ${channel}. Grant them and retry.`,
      });
      return;
    }
  }

  service.setSubscription(interaction.guild.id, channel.id);

  const embed = new EmbedBuilder()
    .setColor(WC_COLOR)
    .setTitle('[✓] World Cup live updates enabled')
    .setDescription(
      `Kickoff, goal, and full-time updates will post in ${channel}.` +
      (service.isActive() ? '' : '\n\n*The tournament isn\'t live yet — updates begin once it starts.*'),
    )
    .setFooter({ text: 'Use /worldcup unsubscribe to stop.' });
  await interaction.editReply({ embeds: [embed] });
}

async function handleUnsubscribe(
  interaction: ChatInputCommandInteraction<'cached'>,
  service: any,
): Promise<void> {
  if (!service.getSubscription(interaction.guild.id)) {
    await interaction.editReply({ content: '[!] This server has no live updates configured.' });
    return;
  }
  service.removeSubscription(interaction.guild.id);
  await interaction.editReply({ content: '[✓] World Cup live updates disabled for this server.' });
}

async function handleMatches(
  interaction: ChatInputCommandInteraction<'cached'>,
  service: any,
  sub: string,
): Promise<void> {
  if (!service.isActive()) {
    await interaction.editReply({ content: inactiveMessage(service) });
    return;
  }

  let dateArg: string | null = null;
  let label = 'Today';
  if (sub === 'schedule') {
    dateArg = interaction.options.getString('date');
    if (dateArg && !/^\d{4}-\d{2}-\d{2}$/.test(dateArg)) {
      await interaction.editReply({ content: '[✗] Date must be `YYYY-MM-DD` (e.g. `2026-06-15`).' });
      return;
    }
    if (dateArg) label = dateArg;
  }

  let matches;
  try {
    matches = dateArg
      ? await service.getMatchesForDate(dateArg.replace(/-/g, ''))
      : await service.getToday();
  } catch (err: unknown) {
    logger.warn('/worldcup: source fetch failed', { error: (err as Error).message });
    await interaction.editReply({
      content: '[✗] Couldn\'t reach the score source right now. Please try again in a moment.',
    });
    return;
  }

  await interaction.editReply({ embeds: [WcEmbeds.buildMatchListEmbed(matches, label)] });
}

async function handleStatus(
  interaction: ChatInputCommandInteraction<'cached'>,
  service: any,
): Promise<void> {
  const sub = service.getSubscription(interaction.guild.id);
  const health = service.getHealth();

  let updater: string;
  if (!health.active) {
    updater = '⚪ Tournament not active';
  } else if (health.healthy) {
    updater = `🟢 Auto-updates healthy${health.lastOkAt ? ` (last OK ${agoText(health.lastOkAt)})` : ''}`;
  } else {
    updater =
      `⚠️ Auto-updates degraded${health.lastOkAt ? ` (last success ${agoText(health.lastOkAt)})` : ' (no successful poll yet)'}` +
      ' — use `/worldcup today` to check scores manually.';
  }

  const embed = new EmbedBuilder()
    .setColor(WC_COLOR)
    .setTitle('🏆 World Cup status')
    .addFields(
      { name: 'Live updates channel', value: sub ? `<#${sub.channelId}>` : 'Not configured', inline: true },
      { name: 'Window', value: health.active ? 'Active' : 'Inactive', inline: true },
      { name: 'Live updater', value: updater, inline: false },
    );
  await interaction.editReply({ embeds: [embed] });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function inactiveMessage(service: any): string {
  const win = service.getWindow?.() ?? {};
  const range = win.startDate && win.endDate ? ` (${win.startDate} – ${win.endDate})` : '';
  return `[i] The World Cup isn't active right now${range}.`;
}

function agoText(ts: number): string {
  const sec = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  return `${Math.round(min / 60)}h ago`;
}

export = createWorldCupCommand;
