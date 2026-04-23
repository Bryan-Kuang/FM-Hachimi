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
    urlRefreshThreshold: parseInt(process.env.URL_REFRESH_THRESHOLD) || 20 * 60 * 1000, // Bilibili CDN URL 刷新阈值（默认20分钟）
    // 播放判定阈值 — 用于 Idle 事件到达时判断是否视作"完整播放结束"
    fullTrackThresholdMs: parseInt(process.env.AUDIO_FULL_TRACK_THRESHOLD_MS) || 15000, // 未知时长(duration=0)时，超过 15s 视为完整播放
    shortPlaybackRetryThresholdMs: parseInt(process.env.AUDIO_SHORT_PLAYBACK_RETRY_THRESHOLD_MS) || 3000, // 播放时间 <3s 且未达结尾则视作异常，触发重试
    // FFmpeg 终止优雅期：SIGTERM 发出后等待多久再发 SIGKILL
    killGracePeriodMs: parseInt(process.env.AUDIO_KILL_GRACE_PERIOD_MS) || 1000, // cleanupFFmpegProcess
    ffmpegHangForceKillMs: parseInt(process.env.AUDIO_FFMPEG_HANG_FORCE_KILL_MS) || 2000, // activityMonitor 检测到挂起后的硬 kill 延迟
  },
  voice: {
    connectionTimeoutMs: parseInt(process.env.VOICE_CONNECTION_TIMEOUT_MS) || 15000, // waitForVoiceConnection 超时
    handoffWaitMs: parseInt(process.env.VOICE_HANDOFF_WAIT_MS) || 1000, // play() 后保持 _manualNavigating 的 startup window
    autoDisconnectIdleMs: parseInt(process.env.VOICE_AUTO_DISCONNECT_IDLE_MS) || 60 * 1000, // 无播放自动断开
  },
  retry: {
    voiceJoinBaseBackoffMs: parseInt(process.env.RETRY_VOICE_JOIN_BASE_BACKOFF_MS) || 2000, // joinVoiceChannel 递增退避基数：(attempt+1) * base
    trackRetryDelayMs: parseInt(process.env.RETRY_TRACK_DELAY_MS) || 2000, // retryCurrentTrack 前的等待（legacy；CDN 失败现走 cdnBackoff*）
    // CDN failure 专用指数退避：观察到 bilibili 风控会对同一 URL 反复返回 403 ~30s；
    // 固定 2s 重试 → 3 次全部撞同一签名 → track 被跳过。退避到 3s/15s 后重试，
    // 给 yt-dlp 足够冷却时间拿到新签名。attempt 从 1 计数。
    cdnBackoffBaseMs: parseInt(process.env.RETRY_CDN_BACKOFF_BASE_MS) || 3000, // 第 1 次重试前等待（ms）
    cdnBackoffMultiplier: parseInt(process.env.RETRY_CDN_BACKOFF_MULTIPLIER) || 5, // 每次乘数：3s → 15s → 75s（被 max 截断）
    cdnBackoffMaxMs: parseInt(process.env.RETRY_CDN_BACKOFF_MAX_MS) || 30000, // 上限：单次退避不超过 30s
  },
  logging: {
    level: process.env.LOG_LEVEL || "info",
    file: process.env.LOG_FILE || "bot.log",
    toFile: process.env.LOG_TO_FILE !== "false",
  },
  ui: {
    // ProgressTracker tick interval (ms). Each tick checks whether the
    // progress bar string changed vs. last sent edit; if identical we skip
    // the Discord call entirely (content-hash dedup).
    progressIntervalMs: parseInt(process.env.UI_PROGRESS_INTERVAL_MS) || 1000,
    // Back-pressure detection for the progress tracker. If a single
    // `message.edit()` takes longer than `slowEditThresholdMs` we call that
    // edit "slow" — it usually means Discord's per-channel rate-limit bucket
    // is drained and discord.js's REST client is holding our request. After
    // `slowEditStreakLimit` consecutive slow edits we enter a cooldown of
    // `cooldownMs` during which the tracker keeps ticking on schedule but
    // DOES NOT send any edit at all. That lets the rate-limit bucket and
    // any queued edits drain. When the cooldown ends the tracker resumes
    // normal 1s updates.
    //
    // Why this matters: without a cooldown, a slow edit makes the
    // self-clocking loop schedule the next tick at delay=0, which just
    // enqueues another edit into the already-stuck queue — a classic
    // runaway. The user-visible symptom is "the progress bar refreshed
    // every second at the start of playback, then started refreshing every
    // few seconds after a while" (issue #12 residual).
    slowEditThresholdMs: parseInt(process.env.UI_SLOW_EDIT_THRESHOLD_MS) || 1500,
    slowEditStreakLimit: parseInt(process.env.UI_SLOW_EDIT_STREAK_LIMIT) || 3,
    cooldownMs: parseInt(process.env.UI_COOLDOWN_MS) || 5000,
  },
  bilibili: {
    likeRateThreshold: parseFloat(process.env.BILIBILI_LIKE_RATE_THRESHOLD) || 0.05,
    viewCountThreshold: parseInt(process.env.BILIBILI_VIEW_COUNT_THRESHOLD) || 10000,
    hachimiPageSize: parseInt(process.env.HACHIMI_PAGE_SIZE) || 50,
    hachimiMaxPages: parseInt(process.env.HACHIMI_MAX_PAGES) || 3,
    searchTimeout: parseInt(process.env.BILIBILI_SEARCH_TIMEOUT) || 8000,
    cookiesFile: process.env.BILIBILI_COOKIES_FILE || "",
    // Hachimi partition filter: only 鬼畜区 (119) and 音乐区 (3) sub-partitions allowed
    hachimiAllowedTids: [3, 22, 26, 28, 29, 30, 31, 59, 119, 126, 130, 193, 216, 243],
  },
  test: {
    mode: process.env.TEST_MODE === "true",
    guildId: process.env.TEST_GUILD_ID,
  },
};
