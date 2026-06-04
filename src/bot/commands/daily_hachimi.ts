/**
 * /daily-hachimi 命令
 * 允许服务器管理员配置/关闭每日哈基米音乐推荐，任何人可查看当前状态。
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

const createDailyHachimiCommand = (
  _playbackService: any,
  _queueService: any,
  dailyHachimiService: any,
) => ({
  data: new SlashCommandBuilder()
    .setName('daily-hachimi')
    .setDescription('管理每日哈基米音乐推荐')
    .addSubcommand((sub) =>
      sub
        .setName('setup')
        .setDescription('开启/更新每日推荐（需要管理服务器权限）')
        .addChannelOption((opt) =>
          opt
            .setName('channel')
            .setDescription('推荐消息发送到哪个文字频道')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true),
        )
        .addStringOption((opt) =>
          opt
            .setName('time')
            .setDescription('发送时间，Toronto 时区，格式 HH:MM（默认 12:00）')
            .setRequired(false),
        )
        .addIntegerOption((opt) =>
          opt
            .setName('count')
            .setDescription('每天推荐几首（1-10，默认 1）')
            .setMinValue(1)
            .setMaxValue(10)
            .setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('disable')
        .setDescription('关闭本服务器的每日推荐（需要管理服务器权限）'),
    )
    .addSubcommand((sub) =>
      sub.setName('status').setDescription('查看本服务器的每日推荐配置'),
    ),

  async execute(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
    const sub = interaction.options.getSubcommand();

    if (sub === 'setup' || sub === 'disable') {
      if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
        await interaction.reply({
          content: '[✗] 你需要「管理服务器」权限才能使用此命令。',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      if (sub === 'setup') {
        await handleSetup(interaction, dailyHachimiService);
      } else if (sub === 'disable') {
        await handleDisable(interaction, dailyHachimiService);
      } else {
        await handleStatus(interaction, dailyHachimiService);
      }
    } catch (err: unknown) {
      const e = err as Error;
      logger.error('/daily-hachimi command error', {
        sub,
        guild: interaction.guild?.id,
        user: interaction.user?.username,
        error: e.message,
        stack: e.stack,
      });
      await interaction.editReply({ content: `[✗] 发生内部错误：${e.message}` });
    }
  },
});

// ---------------------------------------------------------------------------
// Subcommand handlers
// ---------------------------------------------------------------------------

async function handleSetup(
  interaction: ChatInputCommandInteraction<'cached'>,
  service: any,
): Promise<void> {
  const channel = interaction.options.getChannel('channel', true);
  const timeStr = interaction.options.getString('time') ?? '12:00';
  const count   = interaction.options.getInteger('count') ?? 1;

  const timeMatch = timeStr.match(/^(\d{1,2}):(\d{2})$/);
  if (!timeMatch) {
    await interaction.editReply({ content: '[✗] 时间格式不正确，请使用 `HH:MM`（例如 `12:00` 或 `08:30`）。' });
    return;
  }

  const hour   = parseInt(timeMatch[1], 10);
  const minute = parseInt(timeMatch[2], 10);

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    await interaction.editReply({ content: '[✗] 时间超出范围，小时 0-23，分钟 0-59。' });
    return;
  }

  const botMember = interaction.guild.members.me;
  if (botMember && !('permissionsFor' in channel)) {
    // channel may not have permissionsFor if it's a partial; skip check silently
  } else if (botMember) {
    const perms = (channel as any).permissionsFor?.(botMember);
    if (perms && !perms.has(['SendMessages', 'EmbedLinks'])) {
      await interaction.editReply({
        content: `[✗] 机器人在 ${channel} 没有「发送消息」和「嵌入链接」权限，请先赋予权限再试。`,
      });
      return;
    }
  }

  try {
    service.setSchedule(interaction.guild.id, {
      channelId: channel.id,
      hour,
      minute,
      count,
      timezone: 'America/Toronto',
    });
  } catch (err: unknown) {
    const e = err as Error;
    logger.error('DailyHachimi: setSchedule failed during /daily-hachimi setup', {
      guildId: interaction.guild.id,
      error: e.message,
    });
    const errEmbed = new EmbedBuilder()
      .setColor(0xE74C3C)
      .setTitle('[✗] 配置保存失败')
      .setDescription(e.message);
    await interaction.editReply({ embeds: [errEmbed] });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(0x00B5FF)
    .setTitle('[✓] 每日哈基米推荐已配置')
    .addFields(
      { name: '📢 频道', value: `${channel}`, inline: true },
      {
        name: '⏰ 时间',
        value: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} Toronto 时区`,
        inline: true,
      },
      { name: '每日数量', value: `${count} 首`, inline: true },
    )
    .setFooter({ text: '使用 /daily-hachimi disable 可随时关闭' });

  await interaction.editReply({ embeds: [embed] });
}

async function handleDisable(
  interaction: ChatInputCommandInteraction<'cached'>,
  service: any,
): Promise<void> {
  const existing = service.getStatus(interaction.guild.id);
  if (!existing) {
    await interaction.editReply({ content: '[!] 本服务器尚未开启每日推荐，无需关闭。' });
    return;
  }
  service.removeSchedule(interaction.guild.id);
  await interaction.editReply({ content: '[✓] 已关闭本服务器的每日哈基米推荐。' });
}

async function handleStatus(
  interaction: ChatInputCommandInteraction<'cached'>,
  service: any,
): Promise<void> {
  const cfg = service.getStatus(interaction.guild.id);

  if (!cfg) {
    await interaction.editReply({
      content: '[i] 本服务器尚未开启每日推荐。服务器管理员可使用 `/daily-hachimi setup` 开启。',
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(0x00B5FF)
    .setTitle('📅 每日哈基米推荐状态')
    .addFields(
      { name: '📢 频道', value: `<#${cfg.channelId}>`, inline: true },
      {
        name: '⏰ 时间',
        value: `${String(cfg.hour).padStart(2, '0')}:${String(cfg.minute).padStart(2, '0')} Toronto 时区`,
        inline: true,
      },
      { name: '每日数量', value: `${cfg.count} 首`, inline: true },
    );

  await interaction.editReply({ embeds: [embed] });
}

export = createDailyHachimiCommand;
