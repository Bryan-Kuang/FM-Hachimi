# Technical Architecture Document

## Discord Bilibili Audio Bot

### 1. Technology Stack

#### 1.1 Core Technologies

- **Runtime Environment**: Node.js 18.x+
- **Programming Language**: JavaScript (ES2022)
- **Discord Library**: Discord.js v14.14+
- **Audio Library**: @discordjs/voice v0.16+
- **Package Manager**: npm

#### 1.2 Audio Processing

- **Audio Extraction**: yt-dlp (Python tool via child_process)
- **Audio Processing**: FFmpeg
- **Audio Encoding**: @discordjs/opus for Discord compatibility
- **Streaming**: Node.js streams for real-time audio delivery

#### 1.3 External Dependencies

```json
{
  "discord.js": "^14.14.1",
  "@discordjs/voice": "^0.16.1",
  "@discordjs/opus": "^0.9.0",
  "axios": "^1.6.0",
  "yt-dlp-wrap": "^2.3.12",
  "ffmpeg-static": "^5.2.0",
  "node-opus": "^0.3.3",
  "winston": "^3.11.0",
  "dotenv": "^16.3.1",
  "canvas": "^2.11.2",
  "moment": "^2.29.4"
}
```

### 2. System Architecture

#### 2.1 High-Level Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│                 │    │                 │    │                 │
│   Discord API   │◄──►│   Bot Service   │◄──►│ Audio Processor │
│                 │    │                 │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                │                       │
                                ▼                       ▼
                       ┌─────────────────┐    ┌─────────────────┐
                       │                 │    │                 │
                       │ Queue Manager   │    │ Bilibili API    │
                       │                 │    │                 │
                       └─────────────────┘    └─────────────────┘
```

#### 2.2 Module Structure

```
src/
├── bot/
│   ├── client.js           # Discord client initialization
│   ├── commands/           # Slash command handlers
│   │   ├── play.js
│   │   ├── pause.js
│   │   ├── resume.js
│   │   ├── skip.js
│   │   ├── prev.js
│   │   ├── queue.js
│   │   └── nowplaying.js
│   └── events/             # Event handlers
│       ├── ready.js
│       └── interactionCreate.js
├── audio/
│   ├── extractor.js        # Bilibili audio extraction
│   ├── player.js           # Audio playback management
│   ├── queue.js            # Queue management
│   └── stream.js           # Audio streaming utilities
├── ui/
│   ├── embeds.js           # Rich embed generators
│   ├── buttons.js          # Interactive button components
│   ├── progressBar.js      # Progress bar visualization
│   └── visualization.js    # Audio waveform/spectrum (future)
├── utils/
│   ├── logger.js           # Logging utility
│   ├── validator.js        # URL validation
│   ├── errorHandler.js     # Error handling
│   └── formatters.js       # Time and text formatting
├── config/
│   └── config.js           # Configuration management
└── index.js                # Application entry point
```

### 3. Audio Processing Pipeline

#### 3.1 Audio Extraction Flow

```
Bilibili URL → URL Validation → yt-dlp → Audio Stream → FFmpeg → Opus → Discord
```

#### 3.2 Processing Steps

1. **URL Parsing**: Extract video ID from various Bilibili URL formats
2. **Metadata Retrieval**: Get video title, duration, and stream info
3. **Audio Extraction**: Use yt-dlp to extract audio stream URL
4. **Format Conversion**: Convert to Discord-compatible format using FFmpeg
5. **Opus Encoding**: Encode audio for Discord voice transmission
6. **Streaming**: Stream processed audio to Discord voice channel

#### 3.3 Supported URL Formats

- `https://www.bilibili.com/video/BV*`
- `https://www.bilibili.com/video/av*`
- `https://b23.tv/*` (short links)
- `https://m.bilibili.com/video/*` (mobile links)

### 4. Queue Management System

#### 4.1 Queue Structure

```javascript
class AudioQueue {
  constructor() {
    this.items = []; // Array of queue items
    this.currentIndex = -1; // Current playing index
    this.isPlaying = false; // Playback status
    this.isPaused = false; // Pause status
  }
}

class QueueItem {
  constructor(url, title, duration, requestedBy) {
    this.url = url;
    this.title = title;
    this.duration = duration;
    this.requestedBy = requestedBy;
    this.addedAt = new Date();
  }
}
```

#### 4.2 Queue Operations

- **Add**: Append new item to queue
- **Next**: Move to next item in queue
- **Previous**: Move to previous item in queue
- **Remove**: Remove specific item from queue
- **Clear**: Empty the entire queue
- **Shuffle**: Randomize queue order (future feature)

### 5. Discord Integration & UI

#### 5.1 Slash Commands Implementation

```javascript
// Command structure
{
  name: 'play',
  description: 'Play audio from Bilibili video',
  options: [{
    name: 'url',
    description: 'Bilibili video URL',
    type: ApplicationCommandOptionType.String,
    required: true
  }]
}
```

#### 5.2 Rich Embed System

```javascript
// Playback embed structure
const playbackEmbed = new EmbedBuilder()
  .setTitle("🎵 Now Playing")
  .setDescription(`**${videoTitle}**`)
  .setThumbnail(videoThumbnail)
  .addFields(
    { name: "⏱️ Duration", value: formatTime(duration), inline: true },
    { name: "👤 Requested by", value: user.displayName, inline: true },
    {
      name: "📊 Progress",
      value: generateProgressBar(currentTime, duration),
      inline: false,
    }
  )
  .setColor(0x00ae86)
  .setTimestamp();
```

#### 5.3 Interactive Components

```javascript
// Control buttons
const controlRow = new ActionRowBuilder().addComponents(
  new ButtonBuilder()
    .setCustomId("prev")
    .setLabel("⏮️")
    .setStyle(ButtonStyle.Secondary),
  new ButtonBuilder()
    .setCustomId("pause_resume")
    .setLabel(isPlaying ? "⏸️" : "▶️")
    .setStyle(ButtonStyle.Primary),
  new ButtonBuilder()
    .setCustomId("skip")
    .setLabel("⏭️")
    .setStyle(ButtonStyle.Secondary),
  new ButtonBuilder()
    .setCustomId("queue")
    .setLabel("📋")
    .setStyle(ButtonStyle.Secondary)
);
```

#### 5.4 Progress Bar Visualization

```javascript
// Unicode progress bar generation
function generateProgressBar(current, total, length = 20) {
  const progress = Math.round((current / total) * length);
  const emptyProgress = length - progress;

  const progressText = "█".repeat(progress);
  const emptyProgressText = "░".repeat(emptyProgress);

  const percentage = Math.round((current / total) * 100);
  const currentFormatted = formatTime(current);
  const totalFormatted = formatTime(total);

  return `${progressText}${emptyProgressText} ${percentage}% | ${currentFormatted} / ${totalFormatted}`;
}
```

#### 5.5 Real-time Updates

- **Auto-refresh**: Update embeds every 15 seconds during playback
- **Event-driven**: Immediate updates on play/pause/skip events
- **Status Sync**: Sync visual state with actual playback state
- **Error Display**: Show connection issues and failures

#### 5.6 Voice Connection Management

- **Connection Establishment**: Connect to user's voice channel
- **Connection Persistence**: Maintain connection during playback
- **Auto Disconnect**: Disconnect after inactivity timeout
- **Reconnection Logic**: Handle connection drops gracefully

### 6. Error Handling Strategy

#### 6.1 Error Categories

- **Network Errors**: Connection failures, timeouts
- **API Errors**: Bilibili API changes, rate limiting
- **Audio Errors**: Extraction failures, format issues
- **Discord Errors**: Voice connection issues, permission errors

#### 6.2 Error Recovery

```javascript
class ErrorHandler {
  static async handleAudioError(error, context) {
    switch (error.type) {
      case "EXTRACTION_FAILED":
        return this.retryExtraction(context);
      case "CONNECTION_LOST":
        return this.reconnectVoice(context);
      case "FORMAT_UNSUPPORTED":
        return this.fallbackFormat(context);
      default:
        return this.logAndNotify(error, context);
    }
  }
}
```

### 7. Performance Optimization

#### 7.1 Memory Management

- **Stream Processing**: Process audio in chunks to minimize memory usage
- **Garbage Collection**: Properly dispose of resources after playback
- **Connection Pooling**: Reuse connections where possible

#### 7.2 Caching Strategy

- **Metadata Caching**: Cache video information for 1 hour
- **Stream URL Caching**: Cache direct stream URLs for 30 minutes
- **User Preferences**: Cache user settings (future feature)

#### 7.3 Rate Limiting

- **Command Rate Limiting**: Max 5 commands per user per minute
- **Queue Size Limit**: Max 50 items per queue
- **Concurrent Processing**: Max 3 simultaneous audio extractions

### 8. Security Considerations

#### 8.1 Input Validation

- **URL Sanitization**: Validate and sanitize all input URLs
- **Command Validation**: Verify command parameters
- **Permission Checks**: Ensure user has voice channel access

#### 8.2 Resource Protection

- **Process Isolation**: Run yt-dlp in isolated child processes
- **Timeout Limits**: Set timeouts for all external operations
- **Resource Monitoring**: Monitor CPU and memory usage

### 9. Deployment Architecture

#### 9.1 Environment Configuration

```javascript
// config/config.js
module.exports = {
  discord: {
    token: process.env.DISCORD_TOKEN,
    clientId: process.env.CLIENT_ID,
    guildId: process.env.GUILD_ID,
  },
  audio: {
    maxQueueSize: 50,
    extractionTimeout: 30000,
    inactivityTimeout: 300000,
  },
  logging: {
    level: process.env.LOG_LEVEL || "info",
    file: process.env.LOG_FILE || "bot.log",
  },
};
```

#### 9.2 Process Management

- **PM2**: Process manager for production deployment
- **Health Checks**: Regular health monitoring
- **Auto Restart**: Automatic restart on crashes
- **Log Rotation**: Prevent log files from growing too large

### 10. Development Workflow

#### 10.1 Development Setup

1. Install Node.js 18.x+
2. Install Python 3.8+ (for yt-dlp)
3. Install FFmpeg
4. Clone repository and install dependencies
5. Configure environment variables
6. Start development server

#### 10.2 Testing Strategy

- **Unit Tests**: Test individual modules
- **Integration Tests**: Test Discord API integration
- **Audio Tests**: Test audio extraction and playback
- **Error Tests**: Test error handling scenarios

#### 10.3 Build Process

```bash
# Development
npm run dev

# Production build
npm run build

# Deploy
npm run deploy
```

### 11. Monitoring and Logging

#### 11.1 Logging Levels

- **ERROR**: Critical errors requiring immediate attention
- **WARN**: Non-critical issues that should be monitored
- **INFO**: General information about bot operations
- **DEBUG**: Detailed debugging information (development only)

#### 11.2 Metrics Tracking

- **Command Usage**: Track command frequency and success rates
- **Audio Quality**: Monitor extraction success and failure rates
- **Performance**: Track response times and resource usage
- **User Activity**: Monitor active users and queue usage

---

**Document Version:** 1.0  
**Last Updated:** 2025 Sep 1  
**Review Status:** Draft  
**Dependencies:** PRD v1.0
