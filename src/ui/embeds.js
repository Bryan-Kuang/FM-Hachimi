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
      queuePosition = 0,
      totalQueue = 0,
      isPlaying = true,
      loopMode = "none",
      volume = 50,
    } = options;

    // Modern gradient colors for different states
    const colors = {
      playing: 0x1DB954,    // Spotify green
      paused: 0xFF6B35,     // Orange
      stopped: 0x6C757D,    // Gray
    };

    const statusEmoji = isPlaying ? "▶️" : "⏸️";
    const statusText = isPlaying ? "Now Playing" : "Paused";
    
    const embed = new EmbedBuilder()
      .setTitle(`${statusEmoji} ${statusText}`)
      .setColor(isPlaying ? colors.playing : colors.paused)
      .setTimestamp();

    // Enhanced title with better formatting
    const titleText = `**${Formatters.escapeMarkdown(videoData.title)}**`;
    const uploaderText = videoData.uploader ? `*by ${Formatters.escapeMarkdown(videoData.uploader)}*` : "";
    
    embed.setDescription(`${titleText}\n${uploaderText}`);

    // Add high-quality thumbnail
    if (videoData.thumbnail) {
      embed.setThumbnail(videoData.thumbnail);
    }

    // Enhanced progress bar with better visual design
    if (videoData.duration > 0) {
      const progressBar = Formatters.generateProgressBar(
        currentTime,
        videoData.duration,
        20 // Longer progress bar for better visual
      );
      const currentTimeStr = Formatters.formatTime(currentTime);
      const totalTimeStr = Formatters.formatTime(videoData.duration);
      const percentage = Math.round((currentTime / videoData.duration) * 100);

      embed.addFields({
        name: "⏱️ Progress",
        value: `${progressBar}\n\`${currentTimeStr}\` ━━━━━━━━━━━━━━━━━━━━ \`${totalTimeStr}\`\n**${percentage}%** completed`,
        inline: false,
      });
    }

    // Compact info row with emojis
    const infoFields = [];
    
    if (videoData.duration) {
      infoFields.push({
        name: "⏱️ Duration",
        value: `\`${Formatters.formatDuration(videoData.duration)}\``,
        inline: true,
      });
    }

    infoFields.push({
      name: "👤 Requested by",
      value: Formatters.escapeMarkdown(requestedBy),
      inline: true,
    });

    infoFields.push({
      name: "🔊 Volume",
      value: `\`${volume}%\``,
      inline: true,
    });

    embed.addFields(...infoFields);

    // Enhanced queue and loop info
    const statusFields = [];
    
    if (totalQueue > 1) {
      statusFields.push({
        name: "📋 Queue",
        value: `\`${queuePosition}/${totalQueue}\` tracks`,
        inline: true,
      });
    }

    // Loop mode indicator
    const loopEmojis = {
      none: "➡️ Off",
      track: "🔂 Track",
      queue: "🔁 Queue"
    };
    
    statusFields.push({
      name: "🔄 Loop",
      value: `\`${loopEmojis[loopMode] || loopEmojis.none}\``,
      inline: true,
    });

    if (statusFields.length > 0) {
      embed.addFields(...statusFields);
    }

    // Modern footer with platform info
    const footerParts = [];
    if (videoData.videoId) {
      footerParts.push(`🆔 ${videoData.videoId}`);
    }
    if (videoData.uploadDateFormatted) {
      footerParts.push(`📅 ${videoData.uploadDateFormatted}`);
    }
    footerParts.push("🎵 Bilibili Player");

    embed.setFooter({
      text: footerParts.join(" • "),
      iconURL: "https://cdn.discordapp.com/emojis/741605543046807626.png" // Music note icon
    });

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

    if (queue.length === 0) {
      embed.setDescription("🎵 **Queue is empty**\nAdd some tracks to get started!");
      embed.setColor(0x6C757D); // Gray for empty state
      return embed;
    }

    // Calculate display range
    const startIndex = (page - 1) * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, queue.length);
    const displayQueue = queue.slice(startIndex, endIndex);

    // Enhanced queue description with current track info
    let description = "";
    if (currentTrack) {
      description += `🎵 **Now Playing:**\n\`▶️\` ${Formatters.escapeMarkdown(currentTrack.title)}\n\n`;
    }

    description += `📊 **Queue Overview:**\n`;
    description += `• **${queue.length}** tracks total\n`;
    description += `• **${Formatters.formatDuration(queue.reduce((total, track) => total + (track.duration || 0), 0))}** total duration\n`;
    description += `• Page **${page}** of **${totalPages}**\n\n`;

    // Enhanced track listing with better formatting
    description += "🎶 **Up Next:**\n";
    
    displayQueue.forEach((video, index) => {
      const globalIndex = startIndex + index + 1;
      const position = globalIndex.toString().padStart(2, '0');
      const title = Formatters.escapeMarkdown(video.title);
      const duration = video.duration ? Formatters.formatDuration(video.duration) : "Unknown";
      const uploader = video.uploader ? Formatters.escapeMarkdown(video.uploader) : "Unknown";
      
      // Use different formatting for different positions
      if (globalIndex <= 3) {
        // Highlight top 3 tracks
        description += `\`${position}.\` **${title}**\n`;
        description += `     ⏱️ \`${duration}\` • 👤 ${uploader}\n\n`;
      } else {
        // Compact format for other tracks
        description += `\`${position}.\` ${title} • \`${duration}\`\n`;
      }
    });

    // Add pagination info if needed
    if (totalPages > 1) {
      description += `\n📄 **Navigation:**\n`;
      description += `Use queue controls to navigate between pages\n`;
      if (page < totalPages) {
        description += `${queue.length - endIndex} more tracks...`;
      }
    }

    embed.setDescription(description);

    // Add queue statistics as fields
    const stats = [];
    
    // Calculate average duration
    const validDurations = queue.filter(track => track.duration > 0);
    if (validDurations.length > 0) {
      const avgDuration = validDurations.reduce((sum, track) => sum + track.duration, 0) / validDurations.length;
      stats.push({
        name: "📊 Average Duration",
        value: `\`${Formatters.formatDuration(Math.round(avgDuration))}\``,
        inline: true,
      });
    }

    // Show unique uploaders count
    const uniqueUploaders = new Set(queue.filter(track => track.uploader).map(track => track.uploader));
    if (uniqueUploaders.size > 0) {
      stats.push({
        name: "👥 Unique Creators",
        value: `\`${uniqueUploaders.size}\``,
        inline: true,
      });
    }

    // Show page info
    stats.push({
      name: "📄 Page Info",
      value: `\`${page}/${totalPages}\``,
      inline: true,
    });

    if (stats.length > 0) {
      embed.addFields(...stats);
    }

    // Enhanced footer
    embed.setFooter({
      text: `🎵 Bilibili Player • Showing ${startIndex + 1}-${endIndex} of ${queue.length} tracks`,
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
