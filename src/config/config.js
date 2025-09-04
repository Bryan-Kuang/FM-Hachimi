require("dotenv").config();

module.exports = {
  discord: {
    token: process.env.DISCORD_TOKEN,
    clientId: process.env.CLIENT_ID,
    guildId: process.env.GUILD_ID,
  },
  audio: {
    maxQueueSize: parseInt(process.env.MAX_QUEUE_SIZE) || 50,
    extractionTimeout: parseInt(process.env.EXTRACTION_TIMEOUT) || 30000,
    inactivityTimeout: parseInt(process.env.INACTIVITY_TIMEOUT) || 300000,
    // FFmpeg进程监控配置
    ffmpegActivityCheckInterval: parseInt(process.env.FFMPEG_ACTIVITY_CHECK_INTERVAL) || 10000, // 10秒
    ffmpegInactiveWarningThreshold: parseInt(process.env.FFMPEG_INACTIVE_WARNING_THRESHOLD) || 30000, // 30秒
    ffmpegInactiveKillThreshold: parseInt(process.env.FFMPEG_INACTIVE_KILL_THRESHOLD) || 60000, // 60秒
    enableUnlimitedLength: process.env.ENABLE_UNLIMITED_LENGTH !== "false", // 默认启用无限长度播放
  },
  logging: {
    level: process.env.LOG_LEVEL || "info",
    file: process.env.LOG_FILE || "bot.log",
  },
  test: {
    mode: process.env.TEST_MODE === "true",
    guildId: process.env.TEST_GUILD_ID,
  },
};
