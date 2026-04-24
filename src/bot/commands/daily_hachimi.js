/**
 * /daily-hachimi 命令
 * 允许服务器管理员配置/关闭每日哈基米音乐推荐，任何人可查看当前状态。
 */

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  MessageFlags,
  EmbedBuilder,
} = require("discord.js");
const logger = require("../../services/logger_service");

module.exports = function createDailyHachimiCommand(
  _playbackService,
  _queueService,
  dailyHachimiService
) {
  return {
    data: new SlashCommandBuilder()
      .setName("daily-hachimi")
      .setDescription("管理每日哈基米音乐推荐")
      .addSubcommand((sub) =>
        sub
          .setName("setup")
          .setDescription("开启/更新每日推荐（需要管理服务器权限）")
          .addChannelOption((opt) =>
            opt
              .setName("channel")
              .setDescription("推荐消息发送到哪个文字频道")
              .addChannelTypes(ChannelType.GuildText)
              .setRequired(true)
          )
          .addStringOption((opt) =>
            opt
              .setName("time")
              .setDescription("发送时间，Toronto 时区，格式 HH:MM（默认 12:00）")
              .setRequired(false)
          )
          .addIntegerOption((opt) =>
            opt
              .setName("count")
              .setDescription("每天推荐几首（1-10，默认 1）")
              .setMinValue(1)
              .setMaxValue(10)
              .setRequired(false)
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName("disable")
          .setDescription("关闭本服务器的每日推荐（需要管理服务器权限）")
      )
      .addSubcommand((sub) =>
        sub.setName("status").setDescription("查看本服务器的每日推荐配置")
      ),

    async execute(interaction) {
      const sub = interaction.options.getSubcommand();

      // setup / disable 需要 ManageGuild 权限
      if (sub === "setup" || sub === "disable") {
        if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
          return interaction.reply({
            content: "❌ 你需要「管理服务器」权限才能使用此命令。",
            flags: MessageFlags.Ephemeral,
          });
        }
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      try {
        if (sub === "setup") {
          await handleSetup(interaction, dailyHachimiService);
        } else if (sub === "disable") {
          await handleDisable(interaction, dailyHachimiService);
        } else {
          await handleStatus(interaction, dailyHachimiService);
        }
      } catch (err) {
        logger.error("/daily-hachimi command error", {
          sub,
          guild: interaction.guild?.id,
          user: interaction.user?.username,
          error: err.message,
          stack: err.stack,
        });

        await interaction.editReply({
          content: `❌ 发生内部错误：${err.message}`,
        });
      }
    },
  };
};

// ---------------------------------------------------------------------------
// Subcommand handlers
// ---------------------------------------------------------------------------

async function handleSetup(interaction, service) {
  const channel = interaction.options.getChannel("channel");
  const timeStr = interaction.options.getString("time") || "12:00";
  const count =
    interaction.options.getInteger("count") ||
    1;

  // Validate time format HH:MM
  const timeMatch = timeStr.match(/^(\d{1,2}):(\d{2})$/);
  if (!timeMatch) {
    return interaction.editReply({
      content: "❌ 时间格式不正确，请使用 `HH:MM`（例如 `12:00` 或 `08:30`）。",
    });
  }

  const hour = parseInt(timeMatch[1], 10);
  const minute = parseInt(timeMatch[2], 10);

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return interaction.editReply({
      content: "❌ 时间超出范围，小时 0-23，分钟 0-59。",
    });
  }

  // Check bot has permission to send messages in that channel
  const botMember = interaction.guild.members.me;
  if (!channel.permissionsFor(botMember).has(["SendMessages", "EmbedLinks"])) {
    return interaction.editReply({
      content: `❌ 机器人在 ${channel} 没有「发送消息」和「嵌入链接」权限，请先赋予权限再试。`,
    });
  }

  service.setSchedule(interaction.guild.id, {
    channelId: channel.id,
    hour,
    minute,
    count,
    timezone: "America/Toronto",
  });

  const embed = new EmbedBuilder()
    .setColor(0x00B5FF)
    .setTitle("✅ 每日哈基米推荐已配置")
    .addFields(
      { name: "📢 频道", value: `${channel}`, inline: true },
      { name: "⏰ 时间", value: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} Toronto 时区`, inline: true },
      { name: "🎵 每日数量", value: `${count} 首`, inline: true }
    )
    .setFooter({ text: "使用 /daily-hachimi disable 可随时关闭" });

  await interaction.editReply({ embeds: [embed] });
}

async function handleDisable(interaction, service) {
  const existing = service.getStatus(interaction.guild.id);
  if (!existing) {
    return interaction.editReply({
      content: "⚠️ 本服务器尚未开启每日推荐，无需关闭。",
    });
  }

  service.removeSchedule(interaction.guild.id);

  await interaction.editReply({
    content: "✅ 已关闭本服务器的每日哈基米推荐。",
  });
}

async function handleStatus(interaction, service) {
  const cfg = service.getStatus(interaction.guild.id);

  if (!cfg) {
    return interaction.editReply({
      content: "ℹ️ 本服务器尚未开启每日推荐。服务器管理员可使用 `/daily-hachimi setup` 开启。",
    });
  }

  const embed = new EmbedBuilder()
    .setColor(0x00B5FF)
    .setTitle("📅 每日哈基米推荐状态")
    .addFields(
      { name: "📢 频道", value: `<#${cfg.channelId}>`, inline: true },
      {
        name: "⏰ 时间",
        value: `${String(cfg.hour).padStart(2, "0")}:${String(cfg.minute).padStart(2, "0")} Toronto 时区`,
        inline: true,
      },
      { name: "🎵 每日数量", value: `${cfg.count} 首`, inline: true }
    );

  await interaction.editReply({ embeds: [embed] });
}
