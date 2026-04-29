/**
 * Discord Embed Builders
 * Creates rich embeds for various bot responses
 */

const { EmbedBuilder } = require("discord.js");
const Formatters = require("../utils/formatters");

class EmbedBuilders {
  /**
   * Create a modern now playing embed with enhanced visual design
   * @param {Object} videoData - Video metadata
   * @param {Object} options - Additional options
   * @returns {EmbedBuilder} - Discord embed
   */
  static createNowPlayingEmbed(videoData, options = {}) {
    const {
      currentTime = 0,
      requestedBy = "Unknown",
      isPlaying = true,
    } = options;

    const colors = {
      playing: 0x1DB954, // Spotify green
      paused: 0xFF6B35, // Orange
    };
    const statusText = isPlaying ? "Now Playing" : "Paused";

    const embed = new EmbedBuilder()
      .setColor(isPlaying ? colors.playing : colors.paused)
      .setTitle(statusText);

    const pageUrl =
      videoData.url ||
      (videoData.bvid ? `https://www.bilibili.com/video/${videoData.bvid}` : null) ||
      (videoData.videoId ? `https://www.bilibili.com/video/${videoData.videoId}` : null);
    
    const safeTitle = Formatters.escapeMarkdown(videoData.title || "Unknown");
    
    let description = "";
    if (pageUrl) {
      description += `**[${safeTitle}](${pageUrl})**\n\n`;
    } else {
      description += `**${safeTitle}**\n\n`;
    }

    if (videoData.duration > 0) {
      const m = Math.floor(videoData.duration / 60);
      const s = videoData.duration % 60;
      description += `> Duration: ${m}m ${s}s\n`;
    }
    
    description += `> Requested by: @${Formatters.escapeMarkdown(requestedBy)}\n\n`;

    if (videoData.duration > 0) {
      const BAR_WIDTH = 20;
      const filled = Math.min(
        Math.round((currentTime / videoData.duration) * BAR_WIDTH),
        BAR_WIDTH,
      );
      const empty = Math.max(0, BAR_WIDTH - filled);
      const progressBar = "█".repeat(filled) + "░".repeat(empty);
      description += progressBar;
    }

    embed.setDescription(description);

    if (videoData.thumbnail) {
      embed.setThumbnail(videoData.thumbnail);
    }

    return embed;
  }

  /**
   * Create a modern queue embed with enhanced visual design
   * @param {Array} queue - Array of video objects
   * @param {Object} options - Additional options
   * @returns {EmbedBuilder} - Discord embed
   */
  static createQueueEmbed(queue, options = {}) {
    const { page = 1, itemsPerPage = 10, totalPages = 1, currentTrack = null } = options;

    const embed = new EmbedBuilder()
      .setTitle("📋 Music Queue")
      .setColor(0x5865F2) // Discord blurple
      .setTimestamp();

    if (queue.length === 0 && !currentTrack) {
      embed.setDescription("🎵 **Queue is empty**\nAdd some tracks to get started!");
      embed.setColor(0x6C757D); // Gray for empty state
      return embed;
    }

    let description = "";

    // Now Playing section
    if (currentTrack) {
      const title = Formatters.escapeMarkdown(currentTrack.title || "Unknown");
      const bv = currentTrack.videoId || currentTrack.bvid || "";
      description += `▶️ **Now Playing**\n`;
      description += `${title}`;
      if (bv) description += ` • \`${bv}\``;
      description += "\n";
    }

    // Up Next section — subsequent tracks on this page
    const startIndex = (page - 1) * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, queue.length);
    const displayQueue = queue.slice(startIndex, endIndex);

    if (displayQueue.length > 0) {
      description += "\n🎶 **Up Next**\n";
      displayQueue.forEach((video, index) => {
        const pos = startIndex + index + 1;
        const title = Formatters.escapeMarkdown(video.title || "Unknown");
        const bv = video.videoId || video.bvid || "";
        description += `\`${pos}.\` ${title}`;
        if (bv) description += ` • \`${bv}\``;
        description += "\n";
      });
    }

    // Page info
    if (totalPages > 1) {
      description += `\n📄 Page **${page}** / **${totalPages}**`;
    }

    embed.setDescription(description);

    embed.setFooter({
      text: `🎵 Bilibili Player • ${queue.length} track${queue.length !== 1 ? "s" : ""} in queue`,
      iconURL: "https://cdn.discordapp.com/emojis/741605543046807626.png"
    });

    return embed;
  }

  /**
   * Create a modern error embed with enhanced visual design
   * @param {string} title - Error title
   * @param {string} description - Error description
   * @param {Object} options - Additional options
   * @returns {EmbedBuilder} - Discord embed
   */
  static createErrorEmbed(title, description, options = {}) {
    const { 
      errorCode = null, 
      suggestion = null, 
      timestamp = true,
      color = 0xE74C3C // Modern red color
    } = options;

    const embed = new EmbedBuilder()
      .setTitle(`❌ ${title}`)
      .setDescription(`**${description}**`)
      .setColor(color);

    if (timestamp) {
      embed.setTimestamp();
    }

    // Add error details if provided
    const fields = [];
    
    if (errorCode) {
      fields.push({
        name: "🔍 Error Code",
        value: `\`${errorCode}\``,
        inline: true,
      });
    }

    if (suggestion) {
      fields.push({
        name: "💡 Suggestion",
        value: suggestion,
        inline: false,
      });
    }

    // Add common troubleshooting tips
    const troubleshootingTips = [
      "• Check if the video URL is valid and accessible",
      "• Ensure the bot has proper permissions in this channel",
      "• Try again in a few moments if this is a temporary issue",
      "• Contact support if the problem persists"
    ];

    fields.push({
      name: "🛠️ Troubleshooting",
      value: troubleshootingTips.join("\n"),
      inline: false,
    });

    if (fields.length > 0) {
      embed.addFields(...fields);
    }

    // Enhanced footer with support info
    embed.setFooter({
      text: "🎵 Bilibili Player • Need help? Check our documentation",
      iconURL: "https://cdn.discordapp.com/emojis/741605543046807626.png"
    });

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

  /**
   * Create a search results embed
   * @param {Array} results - Search results array
   * @param {string} keyword - Search keyword
   * @returns {EmbedBuilder} - Discord embed
   */
  static createSearchResultsEmbed(results, keyword) {
    const embed = new EmbedBuilder()
      .setTitle("🔍 Search Results")
      .setDescription(`Found ${results.length} results for "**${Formatters.escapeMarkdown(keyword)}**"`)
      .setColor(0x00ae86)
      .setTimestamp();

    // Add up to 10 results as fields
    results.slice(0, 10).forEach((result, index) => {
      const title = result.title.length > 80 ? result.title.substring(0, 80) + "..." : result.title;
      const uploader = result.uploader || "Unknown";
      const duration = result.duration || "Unknown";
      const viewCount = result.viewCount ? Formatters.formatNumber(parseInt(result.viewCount)) : "Unknown";
      
      embed.addFields({
        name: `${index + 1}. ${Formatters.escapeMarkdown(title)}`,
        value: `👤 **${Formatters.escapeMarkdown(uploader)}** | ⏱️ **${duration}** | 👁️ **${viewCount} views**`,
        inline: false,
      });
    });

    embed.setFooter({
      text: "Select a video from the dropdown menu below to add it to the queue",
    });

    return embed;
  }
}

module.exports = EmbedBuilders;
