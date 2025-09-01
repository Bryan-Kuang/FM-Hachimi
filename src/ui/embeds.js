/**
 * Discord Embed Builders
 * Creates rich embeds for various bot responses
 */

const { EmbedBuilder } = require("discord.js");
const Formatters = require("../utils/formatters");

class EmbedBuilders {
  /**
   * Create a now playing embed
   * @param {Object} videoData - Video metadata
   * @param {Object} options - Additional options
   * @returns {EmbedBuilder} - Discord embed
   */
  static createNowPlayingEmbed(videoData, options = {}) {
    const {
      currentTime = 0,
      requestedBy = "Unknown",
      queuePosition = 0,
      totalQueue = 0,
    } = options;

    const embed = new EmbedBuilder()
      .setTitle("🎵 Now Playing")
      .setDescription(`**${Formatters.escapeMarkdown(videoData.title)}**`)
      .setColor(0x00ae86)
      .setTimestamp();

    // Add thumbnail if available
    if (videoData.thumbnail) {
      embed.setThumbnail(videoData.thumbnail);
    }

    // Add main fields
    embed.addFields(
      {
        name: "⏱️ Duration",
        value: Formatters.formatDuration(videoData.duration),
        inline: true,
      },
      {
        name: "👤 Requested by",
        value: Formatters.escapeMarkdown(requestedBy),
        inline: true,
      },
      {
        name: "📺 Uploader",
        value: Formatters.escapeMarkdown(videoData.uploader || "Unknown"),
        inline: true,
      }
    );

    // Add progress bar
    if (videoData.duration > 0) {
      const progressBar = Formatters.generateProgressBar(
        currentTime,
        videoData.duration
      );
      embed.addFields({
        name: "📊 Progress",
        value: `\`${progressBar}\``,
        inline: false,
      });
    }

    // Add queue info if available
    if (totalQueue > 1) {
      embed.addFields({
        name: "📋 Queue",
        value: `${queuePosition}/${totalQueue} tracks`,
        inline: true,
      });
    }

    // Add video info in footer
    if (videoData.videoId) {
      embed.setFooter({
        text: `Video ID: ${videoData.videoId}${
          videoData.uploadDateFormatted
            ? ` • Uploaded: ${videoData.uploadDateFormatted}`
            : ""
        }`,
      });
    }

    return embed;
  }

  /**
   * Create a queue display embed
   * @param {Array} queue - Array of queue items
   * @param {number} currentIndex - Current playing index
   * @returns {EmbedBuilder} - Discord embed
   */
  static createQueueEmbed(queue, currentIndex = -1) {
    const embed = new EmbedBuilder()
      .setTitle("📋 Queue")
      .setColor(0x0099ff)
      .setTimestamp();

    if (!queue || queue.length === 0) {
      embed.setDescription("The queue is empty. Use `/play` to add songs!");
      return embed;
    }

    const totalDuration = queue.reduce(
      (total, item) => total + (item.duration || 0),
      0
    );

    embed.setDescription(
      `**${
        queue.length
      } song(s) in queue** • Total duration: ${Formatters.formatDuration(
        totalDuration
      )}`
    );

    // Show up to 10 songs in the queue
    const displayQueue = queue.slice(0, 10);
    let queueText = "";

    displayQueue.forEach((item, index) => {
      const isCurrentlyPlaying = index === currentIndex;
      const position = index + 1;
      const statusIcon = isCurrentlyPlaying ? "▶️" : `${position}.`;

      const title = Formatters.truncateText(item.title, 40);
      const duration = Formatters.formatTime(item.duration);
      const requestedBy = Formatters.truncateText(
        item.requestedBy || "Unknown",
        15
      );

      queueText += `${statusIcon} **${title}**\n`;
      queueText += `   Duration: \`${duration}\` • Requested by: ${requestedBy}\n\n`;
    });

    if (queueText) {
      embed.addFields({
        name: "🎵 Tracks",
        value: queueText,
        inline: false,
      });
    }

    // Add "and more" if queue is longer than 10
    if (queue.length > 10) {
      embed.addFields({
        name: "➕ And more...",
        value: `${queue.length - 10} more song(s) in queue`,
        inline: false,
      });
    }

    return embed;
  }

  /**
   * Create an error embed
   * @param {string} title - Error title
   * @param {string} description - Error description
   * @param {Object} options - Additional options
   * @returns {EmbedBuilder} - Discord embed
   */
  static createErrorEmbed(title, description, options = {}) {
    const { suggestion = null, errorCode = null } = options;

    const embed = new EmbedBuilder()
      .setTitle(`❌ ${title}`)
      .setDescription(description)
      .setColor(0xff0000)
      .setTimestamp();

    if (errorCode) {
      embed.addFields({
        name: "Error Code",
        value: `\`${errorCode}\``,
        inline: true,
      });
    }

    if (suggestion) {
      embed.addFields({
        name: "💡 Suggestion",
        value: suggestion,
        inline: false,
      });
    }

    return embed;
  }

  /**
   * Create a success embed
   * @param {string} title - Success title
   * @param {string} description - Success description
   * @returns {EmbedBuilder} - Discord embed
   */
  static createSuccessEmbed(title, description) {
    return new EmbedBuilder()
      .setTitle(`✅ ${title}`)
      .setDescription(description)
      .setColor(0x00ff00)
      .setTimestamp();
  }

  /**
   * Create a loading embed
   * @param {string} description - Loading description
   * @returns {EmbedBuilder} - Discord embed
   */
  static createLoadingEmbed(description = "Processing...") {
    return new EmbedBuilder()
      .setTitle("⏳ Loading")
      .setDescription(description)
      .setColor(0xffff00)
      .setTimestamp();
  }

  /**
   * Create a help embed
   * @param {Array} commands - Array of command objects
   * @returns {EmbedBuilder} - Discord embed
   */
  static createHelpEmbed(commands) {
    const embed = new EmbedBuilder()
      .setTitle("🎵 Bilibili Discord Bot - Commands")
      .setDescription(
        "Play audio from Bilibili videos in Discord voice channels!"
      )
      .setColor(0x00ae86)
      .setTimestamp();

    let commandText = "";
    commands.forEach((command) => {
      commandText += `**/${command.name}** - ${command.description}\n`;
    });

    if (commandText) {
      embed.addFields({
        name: "📝 Available Commands",
        value: commandText,
        inline: false,
      });
    }

    embed.addFields(
      {
        name: "🔗 Supported URLs",
        value: [
          "• `bilibili.com/video/BV*`",
          "• `bilibili.com/video/av*`",
          "• `b23.tv/*` (short links)",
          "• `m.bilibili.com/video/*`",
        ].join("\n"),
        inline: true,
      },
      {
        name: "⚙️ Features",
        value: [
          "• High-quality audio streaming",
          "• Interactive controls",
          "• Queue management",
          "• Real-time progress tracking",
        ].join("\n"),
        inline: true,
      }
    );

    embed.setFooter({
      text: "Use the buttons below each message for quick controls!",
    });

    return embed;
  }

  /**
   * Create a bot info embed
   * @param {Object} stats - Bot statistics
   * @returns {EmbedBuilder} - Discord embed
   */
  static createBotInfoEmbed(stats) {
    const embed = new EmbedBuilder()
      .setTitle("🤖 Bot Information")
      .setColor(0x7289da)
      .setTimestamp();

    if (stats.ready) {
      const uptimeFormatted = Formatters.formatDuration(stats.uptime);

      embed.addFields(
        {
          name: "📊 Statistics",
          value: [
            `**Servers:** ${stats.guilds}`,
            `**Uptime:** ${uptimeFormatted}`,
            `**Users:** ${stats.users}`,
          ].join("\n"),
          inline: true,
        },
        {
          name: "🔧 Status",
          value: [
            `**Name:** ${stats.username}`,
            `**ID:** ${stats.id}`,
            `**Status:** 🟢 Online`,
          ].join("\n"),
          inline: true,
        }
      );
    } else {
      embed.setDescription("Bot is starting up...");
    }

    return embed;
  }
}

module.exports = EmbedBuilders;
