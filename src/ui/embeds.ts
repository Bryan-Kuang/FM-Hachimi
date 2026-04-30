/**
 * Discord Embed Builders
 * Creates rich embeds for various bot responses
 */

import { EmbedBuilder } from 'discord.js';
import Formatters = require('../utils/formatters');
import type { TrackData } from '../types';

// Extended track shape available at embed-build time (includes queue-time fields)
interface EmbedTrack extends TrackData {
  requestedBy?: string;
  retryCount?: number;
}

// Options for createNowPlayingEmbed
interface NowPlayingOptions {
  currentTime?: number;
  requestedBy?: string;
  isPlaying?: boolean;
  queuePosition?: number;
  totalQueue?: number;
  loopMode?: string;
}

// Options for createQueueEmbed
interface QueueOptions {
  page?: number;
  itemsPerPage?: number;
  totalPages?: number;
  currentTrack?: EmbedTrack | null;
}

// Options for createErrorEmbed
interface ErrorOptions {
  errorCode?: string | null;
  suggestion?: string | null;
  timestamp?: boolean;
  color?: number;
}

// Shape of bot stats for createBotInfoEmbed
interface BotStats {
  ready: boolean;
  uptime?: number;
  guilds?: number;
  users?: number;
  username?: string;
  id?: string;
}

// Shape of a search result for createSearchResultsEmbed
interface SearchResultItem {
  title: string;
  uploader?: string;
  duration?: string | number;
  viewCount?: string | number;
}

// Shape of a queue track item for createQueueEmbed
interface QueueItem {
  title?: string;
  bvid?: string;
  videoId?: string;
}

// Shape of a command descriptor for createHelpEmbed
interface CommandDescriptor {
  name: string;
  description: string;
}

class EmbedBuilders {
  /**
   * Create a now playing embed with progress bar.
   */
  static createNowPlayingEmbed(videoData: EmbedTrack, options: NowPlayingOptions = {}): EmbedBuilder {
    const {
      currentTime = 0,
      requestedBy = 'Unknown',
      isPlaying = true,
    } = options;

    const colors = {
      playing: 0x1DB954, // Spotify green
      paused: 0xFF6B35,  // Orange
    };
    const statusText = isPlaying ? 'Now Playing' : 'Paused';

    const embed = new EmbedBuilder()
      .setColor(isPlaying ? colors.playing : colors.paused);

    const pageUrl =
      videoData.url ||
      (videoData.bvid ? `https://www.bilibili.com/video/${videoData.bvid}` : null) ||
      (videoData.videoId ? `https://www.bilibili.com/video/${videoData.videoId}` : null);

    const safeTitle = Formatters.escapeMarkdown(videoData.title || 'Unknown');

    // "Now Playing" lives inside the description (not setTitle) to eliminate
    // the fixed gap Discord always inserts between title and description.
    let description = `**${statusText}**\n`;
    if (pageUrl) {
      description += `**[${safeTitle}](${pageUrl})**\n`;
    } else {
      description += `**${safeTitle}**\n`;
    }

    if (videoData.duration > 0) {
      const m = Math.floor(videoData.duration / 60);
      const s = Math.floor(videoData.duration % 60);
      description += `> Duration: ${m}m ${s}s\n`;
    }

    description += `> Requested by: ${Formatters.escapeMarkdown(requestedBy)}`;

    embed.setDescription(description);

    if (videoData.thumbnail) {
      // Route through wsrv.nl to center-crop the image into a square before
      // Discord renders it at 80×80. Without this, a 16:9 Bilibili cover
      // would be letterboxed and most of the 80px height would be wasted.
      const rawUrl = videoData.thumbnail.replace(/^https?:\/\//, '');
      const croppedUrl = `https://wsrv.nl/?url=${encodeURIComponent(rawUrl)}&w=80&h=80&fit=cover&a=center`;
      embed.setThumbnail(croppedUrl);
    }

    // Progress bar rendered full-width BELOW the thumbnail column.
    if (videoData.duration > 0) {
      const BAR_WIDTH = 20;
      const filled = Math.min(
        Math.round((currentTime / videoData.duration) * BAR_WIDTH),
        BAR_WIDTH,
      );
      const empty = Math.max(0, BAR_WIDTH - filled);
      const progressBar = '█'.repeat(filled) + '░'.repeat(empty);
      embed.addFields({ name: 'Progress', value: progressBar, inline: false });
    }

    return embed;
  }

  /**
   * Create a queue embed.
   */
  static createQueueEmbed(queue: QueueItem[], options: QueueOptions = {}): EmbedBuilder {
    const { page = 1, itemsPerPage = 10, totalPages = 1, currentTrack = null } = options;

    const embed = new EmbedBuilder()
      .setTitle('📋 Music Queue')
      .setColor(0x5865F2)
      .setTimestamp();

    if (queue.length === 0 && !currentTrack) {
      embed.setDescription('🎵 **Queue is empty**\nAdd some tracks to get started!');
      embed.setColor(0x6C757D);
      return embed;
    }

    let description = '';

    if (currentTrack) {
      const title = Formatters.escapeMarkdown(currentTrack.title || 'Unknown');
      const bv = currentTrack.videoId || currentTrack.bvid || '';
      description += '▶️ **Now Playing**\n';
      description += `${title}`;
      if (bv) description += ` • \`${bv}\``;
      description += '\n';
    }

    const startIndex = (page - 1) * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, queue.length);
    const displayQueue = queue.slice(startIndex, endIndex);

    if (displayQueue.length > 0) {
      description += '\n🎶 **Up Next**\n';
      displayQueue.forEach((video, index) => {
        const pos = startIndex + index + 1;
        const title = Formatters.escapeMarkdown(video.title || 'Unknown');
        const bv = video.videoId || video.bvid || '';
        description += `\`${pos}.\` ${title}`;
        if (bv) description += ` • \`${bv}\``;
        description += '\n';
      });
    }

    if (totalPages > 1) {
      description += `\n📄 Page **${page}** / **${totalPages}**`;
    }

    embed.setDescription(description);
    embed.setFooter({
      text: `🎵 Bilibili Player • ${queue.length} track${queue.length !== 1 ? 's' : ''} in queue`,
      iconURL: 'https://cdn.discordapp.com/emojis/741605543046807626.png',
    });

    return embed;
  }

  /**
   * Create an error embed.
   */
  static createErrorEmbed(title: string, description: string, options: ErrorOptions = {}): EmbedBuilder {
    const {
      errorCode = null,
      suggestion = null,
      timestamp = true,
      color = 0xE74C3C,
    } = options;

    const embed = new EmbedBuilder()
      .setTitle(`❌ ${title}`)
      .setDescription(`**${description}**`)
      .setColor(color);

    if (timestamp) embed.setTimestamp();

    const fields: { name: string; value: string; inline: boolean }[] = [];

    if (errorCode) {
      fields.push({ name: '🔍 Error Code', value: `\`${errorCode}\``, inline: true });
    }

    if (suggestion) {
      fields.push({ name: '💡 Suggestion', value: suggestion, inline: false });
    }

    const troubleshootingTips = [
      '• Check if the video URL is valid and accessible',
      '• Ensure the bot has proper permissions in this channel',
      '• Try again in a few moments if this is a temporary issue',
      '• Contact support if the problem persists',
    ];

    fields.push({ name: '🛠️ Troubleshooting', value: troubleshootingTips.join('\n'), inline: false });

    if (fields.length > 0) embed.addFields(...fields);

    embed.setFooter({
      text: '🎵 Bilibili Player • Need help? Check our documentation',
      iconURL: 'https://cdn.discordapp.com/emojis/741605543046807626.png',
    });

    return embed;
  }

  /**
   * Create a success embed.
   */
  static createSuccessEmbed(title: string, description: string): EmbedBuilder {
    return new EmbedBuilder()
      .setTitle(`✅ ${title}`)
      .setDescription(description)
      .setColor(0x00ff00)
      .setTimestamp();
  }

  /**
   * Create a loading embed.
   */
  static createLoadingEmbed(description = 'Processing...'): EmbedBuilder {
    return new EmbedBuilder()
      .setTitle('⏳ Loading')
      .setDescription(description)
      .setColor(0xffff00)
      .setTimestamp();
  }

  /**
   * Create a help embed.
   */
  static createHelpEmbed(commands: CommandDescriptor[]): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setTitle('🎵 Bilibili Discord Bot - Commands')
      .setDescription('Play audio from Bilibili videos in Discord voice channels!')
      .setColor(0x00ae86)
      .setTimestamp();

    let commandText = '';
    commands.forEach((command) => {
      commandText += `**/${command.name}** - ${command.description}\n`;
    });

    if (commandText) {
      embed.addFields({ name: '📝 Available Commands', value: commandText, inline: false });
    }

    embed.addFields(
      {
        name: '🔗 Supported URLs',
        value: [
          '• `bilibili.com/video/BV*`',
          '• `bilibili.com/video/av*`',
          '• `b23.tv/*` (short links)',
          '• `m.bilibili.com/video/*`',
        ].join('\n'),
        inline: true,
      },
      {
        name: '⚙️ Features',
        value: [
          '• High-quality audio streaming',
          '• Interactive controls',
          '• Queue management',
          '• Real-time progress tracking',
        ].join('\n'),
        inline: true,
      },
    );

    embed.setFooter({ text: 'Use the buttons below each message for quick controls!' });

    return embed;
  }

  /**
   * Create a bot info embed.
   */
  static createBotInfoEmbed(stats: BotStats): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setTitle('🤖 Bot Information')
      .setColor(0x7289da)
      .setTimestamp();

    if (stats.ready) {
      const uptimeFormatted = Formatters.formatDuration(stats.uptime ?? 0);
      embed.addFields(
        {
          name: '📊 Statistics',
          value: [
            `**Servers:** ${stats.guilds}`,
            `**Uptime:** ${uptimeFormatted}`,
            `**Users:** ${stats.users}`,
          ].join('\n'),
          inline: true,
        },
        {
          name: '🔧 Status',
          value: [
            `**Name:** ${stats.username}`,
            `**ID:** ${stats.id}`,
            '**Status:** 🟢 Online',
          ].join('\n'),
          inline: true,
        },
      );
    } else {
      embed.setDescription('Bot is starting up...');
    }

    return embed;
  }

  /**
   * Create a search results embed.
   */
  static createSearchResultsEmbed(results: SearchResultItem[], keyword: string): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setTitle('🔍 Search Results')
      .setDescription(`Found ${results.length} results for "**${Formatters.escapeMarkdown(keyword)}**"`)
      .setColor(0x00ae86)
      .setTimestamp();

    results.slice(0, 10).forEach((result, index) => {
      const title = result.title.length > 80 ? result.title.substring(0, 80) + '...' : result.title;
      const uploader = result.uploader || 'Unknown';
      const duration = result.duration || 'Unknown';
      const viewCount = result.viewCount
        ? Formatters.formatNumber(parseInt(String(result.viewCount)))
        : 'Unknown';

      embed.addFields({
        name: `${index + 1}. ${Formatters.escapeMarkdown(title)}`,
        value: `👤 **${Formatters.escapeMarkdown(uploader)}** | ⏱️ **${duration}** | 👁️ **${viewCount} views**`,
        inline: false,
      });
    });

    embed.setFooter({
      text: 'Select a video from the dropdown menu below to add it to the queue',
    });

    return embed;
  }
}

export = EmbedBuilders;
