import 'dotenv/config';
import path from 'path';

interface DiscordConfig {
  token: string | undefined;
  clientId: string | undefined;
  guildId: string | undefined;
}

interface AudioConfig {
  maxQueueSize: number;
  extractionTimeout: number;
  inactivityTimeout: number;
  // FFmpeg进程监控配置
  ffmpegActivityCheckInterval: number;
  ffmpegInactiveWarningThreshold: number;
  ffmpegInactiveKillThreshold: number;
  enableUnlimitedLength: boolean;
  urlRefreshThreshold: number;
  /** FFmpeg -af audio filter chain. Default normalizes loudness across tracks. */
  audioFilter: string;
  // 播放判定阈值 — 用于 Idle 事件到达时判断是否视作"完整播放结束"
  fullTrackThresholdMs: number;
  shortPlaybackRetryThresholdMs: number;
  // FFmpeg 终止优雅期：SIGTERM 发出后等待多久再发 SIGKILL
  killGracePeriodMs: number;
  ffmpegHangForceKillMs: number;
}

interface VoiceConfig {
  connectionTimeoutMs: number;
  handoffWaitMs: number;
  autoDisconnectIdleMs: number;
}

interface RetryConfig {
  voiceJoinBaseBackoffMs: number;
  trackRetryDelayMs: number;
  cdnBackoffBaseMs: number;
  cdnBackoffMultiplier: number;
  cdnBackoffMaxMs: number;
}

interface LoggingConfig {
  level: string;
  file: string;
  toFile: boolean;
}

interface UiConfig {
  progressIntervalMs: number;
  slowEditThresholdMs: number;
  slowEditStreakLimit: number;
  cooldownMs: number;
}

interface BilibiliConfig {
  likeRateThreshold: number;
  viewCountThreshold: number;
  hachimiPageSize: number;
  hachimiMaxPages: number;
  searchTimeout: number;
  cookiesFile: string;
  nativeExtractorEnabled: boolean;
  nativeFallbackToYtdlp: boolean;
  preextractEnabled: boolean;
  preextractConcurrency: number;
  preextractMaxPerCardSet: number;
  hachimiAllowedTids: number[];
  hachimiMaxDurationSec: number;
  hachimiMinDurationSec: number;
  hachimiSearchKeywords: string[];
}

interface YouTubeConfig {
  preextractEnabled: boolean;
  preextractConcurrency: number;
  preextractMaxPerCardSet: number;
  playerClient: string;
  potProviderUrl: string;
  mediaCacheEnabled: boolean;
  mediaCacheDir: string;
  mediaCacheMaxEntries: number;
  mediaCacheMaxBytes: number;
  cookieRefresh: YouTubeCookieRefreshConfig;
}

interface YouTubeCookieRefreshConfig {
  enabled: boolean;
  cookiesFile: string;
  browserSpec: string;
  refreshIntervalMs: number;
  cooldownMs: number;
  validateUrls: string[];
}

interface RadioConfig {
  enabled: boolean;
  replenishMaxAttempts: number;
  // Periodic "take a break" video injected into radio rotation. The feature is
  // gated to the test guild (see TEST_GUILD_ID); the interval is global.
  breakEnabled: boolean;
  breakIntervalMinutes: number;
  breakVideoUrl: string;
}

interface DailyHachimiConfig {
  dataFile: string;
  historyFile: string;
  defaultTimezone: string;
  defaultCount: number;
}

interface WorldCupConfig {
  enabled: boolean;
  /** Inclusive tournament start date (YYYY-MM-DD, UTC). */
  startDate: string;
  /** Exclusive tournament end date (YYYY-MM-DD, UTC) — feature inert from here on. */
  endDate: string;
  /** ESPN public scoreboard endpoint (no auth). `?dates=YYYYMMDD` is appended. */
  sourceUrl: string;
  /** Free live-stream destination linked from messages (empty disables the link). */
  streamUrl: string;
  /** Display name for the watch-live link (e.g. "88看球"). */
  streamLabel: string;
  /** Poll cadence while any match is live. */
  livePollMs: number;
  /** Poll cadence when no match is live (and the back-off cadence on repeated failure). */
  idlePollMs: number;
  requestTimeoutMs: number;
  /** Dir for subscriptions.json + state.json (under the persisted data/ mount). */
  dataDir: string;
  /** Display timezone for kickoff times. */
  timezone: string;
}

interface AnnoyingConfig {
  /**
   * Discord user (numeric ID or username) allowed to disconnect/move the bot
   * while annoying mode is on. Kept out of the repo — populated from the
   * ANNOYING_EXEMPT_USER GitHub Actions secret on deploy. Empty ⇒ nobody exempt.
   */
  exemptUser: string;
  /** Delay before the bot rejoins after a hostile disconnect/move. */
  rejoinDelayMs: number;
}

interface ResumeConfig {
  enabled: boolean;
  /** Snapshot file (under the persisted data/ mount so it survives redeploys). */
  dataFile: string;
  /** Snapshots older than this are discarded instead of resumed. */
  maxAgeMs: number;
  /** Flush the snapshot this often while playing (0 disables periodic flush). */
  snapshotIntervalMs: number;
}

interface TestConfig {
  mode: boolean;
  guildId: string | undefined;
}

interface BotConfig {
  discord: DiscordConfig;
  audio: AudioConfig;
  voice: VoiceConfig;
  retry: RetryConfig;
  logging: LoggingConfig;
  ui: UiConfig;
  bilibili: BilibiliConfig;
  youtube: YouTubeConfig;
  radio: RadioConfig;
  dailyHachimi: DailyHachimiConfig;
  worldCup: WorldCupConfig;
  annoying: AnnoyingConfig;
  resume: ResumeConfig;
  test: TestConfig;
}

function parseIntegerEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseListEnv(value: string | undefined, fallback: string[]): string[] {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = value
    .split(",")
    .map(item => item.trim())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : fallback;
}

const config: BotConfig = {
  discord: {
    token: process.env.DISCORD_TOKEN,
    clientId: process.env.CLIENT_ID,
    guildId: process.env.GUILD_ID,
  },
  audio: {
    maxQueueSize: parseInt(process.env.MAX_QUEUE_SIZE!) || 50,
    extractionTimeout: parseInt(process.env.EXTRACTION_TIMEOUT!) || 30000,
    inactivityTimeout: parseInt(process.env.INACTIVITY_TIMEOUT!) || 300000,
    // FFmpeg进程监控配置
    ffmpegActivityCheckInterval: parseInt(process.env.FFMPEG_ACTIVITY_CHECK_INTERVAL!) || 10000, // 10秒
    ffmpegInactiveWarningThreshold: parseInt(process.env.FFMPEG_INACTIVE_WARNING_THRESHOLD!) || 30000, // 30秒
    ffmpegInactiveKillThreshold: parseInt(process.env.FFMPEG_INACTIVE_KILL_THRESHOLD!) || 60000, // 60秒
    enableUnlimitedLength: process.env.ENABLE_UNLIMITED_LENGTH !== "false", // 默认启用无限长度播放
    urlRefreshThreshold: parseInt(process.env.URL_REFRESH_THRESHOLD!) || 20 * 60 * 1000, // Bilibili CDN URL 刷新阈值（默认20分钟）
    // FFmpeg -af filter. dynaudnorm levels loudness across/within tracks (low
    // latency); the trailing volume=0.15 (~-16.5 dB) then sets where that leveled
    // loudness sits — background music level (dynaudnorm alone peak-normalizes;
    // -12 dB still felt foreground-loud in listening tests, and 60% of that
    // level, matched by ear via Discord's user volume slider, sounded right:
    // 0.25 * 0.6 = 0.15). Tune via AUDIO_FILTER — raise volume for louder
    // (e.g. 0.25), lower for quieter; set AUDIO_FILTER="" to disable entirely.
    audioFilter: (process.env.AUDIO_FILTER ?? "dynaudnorm=f=250:g=15,volume=0.15").trim(),
    // 播放判定阈值 — 用于 Idle 事件到达时判断是否视作"完整播放结束"
    fullTrackThresholdMs: parseInt(process.env.AUDIO_FULL_TRACK_THRESHOLD_MS!) || 15000, // 未知时长(duration=0)时，超过 15s 视为完整播放
    shortPlaybackRetryThresholdMs: parseInt(process.env.AUDIO_SHORT_PLAYBACK_RETRY_THRESHOLD_MS!) || 3000, // 播放时间 <3s 且未达结尾则视作异常，触发重试
    // FFmpeg 终止优雅期：SIGTERM 发出后等待多久再发 SIGKILL
    killGracePeriodMs: parseInt(process.env.AUDIO_KILL_GRACE_PERIOD_MS!) || 1000, // cleanupFFmpegProcess
    ffmpegHangForceKillMs: parseInt(process.env.AUDIO_FFMPEG_HANG_FORCE_KILL_MS!) || 2000, // activityMonitor 检测到挂起后的硬 kill 延迟
  },
  voice: {
    connectionTimeoutMs: parseInt(process.env.VOICE_CONNECTION_TIMEOUT_MS!) || 15000, // waitForVoiceConnection 超时
    handoffWaitMs: parseInt(process.env.VOICE_HANDOFF_WAIT_MS!) || 200, // play() 后保持 _manualNavigating 的 startup window（降低: 1000→200ms）
    autoDisconnectIdleMs: parseInt(process.env.VOICE_AUTO_DISCONNECT_IDLE_MS!) || 60 * 1000, // 无播放自动断开
  },
  retry: {
    voiceJoinBaseBackoffMs: parseInt(process.env.RETRY_VOICE_JOIN_BASE_BACKOFF_MS!) || 2000, // joinVoiceChannel 递增退避基数：(attempt+1) * base
    trackRetryDelayMs: parseInt(process.env.RETRY_TRACK_DELAY_MS!) || 2000, // retryCurrentTrack 前的等待（legacy；CDN 失败现走 cdnBackoff*）
    // CDN failure 专用指数退避：观察到 bilibili 风控会对同一 URL 反复返回 403 ~30s；
    // 固定 2s 重试 → 3 次全部撞同一签名 → track 被跳过。退避到 3s/15s 后重试，
    // 给 yt-dlp 足够冷却时间拿到新签名。attempt 从 1 计数。
    cdnBackoffBaseMs: parseInt(process.env.RETRY_CDN_BACKOFF_BASE_MS!) || 3000, // 第 1 次重试前等待（ms）
    cdnBackoffMultiplier: parseInt(process.env.RETRY_CDN_BACKOFF_MULTIPLIER!) || 5, // 每次乘数：3s → 15s → 75s（被 max 截断）
    cdnBackoffMaxMs: parseInt(process.env.RETRY_CDN_BACKOFF_MAX_MS!) || 30000, // 上限：单次退避不超过 30s
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
    //
    // Raised 1000 → 5000 ms (2026-04-28): with the redesigned card showing
    // ONLY the bar (no per-second time numbers), the rendered content
    // changes only when a bar segment flips — for a 3-min track that's
    // every ~9s. Ticking faster than the bar can change just burns CPU
    // on render+hash work that always dedups. 5s gives near-instant
    // detection of segment flips while leaving plenty of headroom under
    // Discord's 5-edits/5s rate limit even with a slow round-trip.
    progressIntervalMs: parseInt(process.env.UI_PROGRESS_INTERVAL_MS!) || 5000,
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
    //
    // Threshold raised 1500 → 2500 ms (2026-04): Discord round-trip in a
    // moderately busy channel routinely sits in the 800–1400 ms range even
    // when the bucket is healthy, and 1500 ms was treating that as a
    // runaway signal — leading to ~5 s freezes triggered by ordinary
    // network jitter. 2500 ms reliably separates "discord.js is holding
    // our request because the bucket is drained" from "ordinary slow
    // round-trip."
    slowEditThresholdMs: parseInt(process.env.UI_SLOW_EDIT_THRESHOLD_MS!) || 2500,
    slowEditStreakLimit: parseInt(process.env.UI_SLOW_EDIT_STREAK_LIMIT!) || 3,
    cooldownMs: parseInt(process.env.UI_COOLDOWN_MS!) || 5000,
  },
  bilibili: {
    likeRateThreshold: parseFloat(process.env.BILIBILI_LIKE_RATE_THRESHOLD!) || 0.05,
    viewCountThreshold: parseInt(process.env.BILIBILI_VIEW_COUNT_THRESHOLD!) || 10000,
    hachimiPageSize: parseInt(process.env.HACHIMI_PAGE_SIZE!) || 50,
    hachimiMaxPages: parseInt(process.env.HACHIMI_MAX_PAGES!) || 3,
    searchTimeout: parseInt(process.env.BILIBILI_SEARCH_TIMEOUT!) || 8000,
    cookiesFile: process.env.BILIBILI_COOKIES_FILE || "/app/secrets/bilibili_cookies.txt",
    nativeExtractorEnabled: process.env.BILIBILI_NATIVE_EXTRACTOR_ENABLED !== "false",
    nativeFallbackToYtdlp: process.env.BILIBILI_NATIVE_FALLBACK_TO_YTDLP !== "false",
    preextractEnabled: process.env.BILIBILI_PREEXTRACT_ENABLED !== "false",
    preextractConcurrency: parseInt(process.env.BILIBILI_PREEXTRACT_CONCURRENCY!) || 2,
    preextractMaxPerCardSet: parseInt(process.env.BILIBILI_PREEXTRACT_MAX_PER_CARD_SET!) || 5,
    // Hachimi partition filter: only 鬼畜区 (119) and 音乐区 (3) sub-partitions allowed
    hachimiAllowedTids: [3, 22, 26, 28, 29, 30, 31, 59, 119, 126, 130, 193, 216, 243],
    // Hachimi duration filter (seconds). Videos with duration=0 (API didn't return it) are
    // passed through so we don't silently drop otherwise-valid results.
    hachimiMaxDurationSec: parseInt(process.env.HACHIMI_MAX_DURATION_SEC!) || 360,  // 6 min
    hachimiMinDurationSec: parseInt(process.env.HACHIMI_MIN_DURATION_SEC!) || 60,   // 1 min
    // Search keywords for the 哈基米 meme-music corpus. The bare keyword "哈基米"
    // ranks lots of non-music content (cat vlogs, game clips, anime cuts) that the
    // downstream filters can't reliably reject, which is how off-topic videos kept
    // reaching recommendations. Music-focused queries keep results on the meme
    // songs; each search samples from this list, which also diversifies the pool.
    hachimiSearchKeywords: parseListEnv(process.env.HACHIMI_SEARCH_KEYWORDS, [
      "哈基米音乐",
      "哈基米 音mad",
      "哈基米 鬼畜",
      "哈基米 remix",
    ]),
  },
  youtube: {
    preextractEnabled: process.env.YOUTUBE_PREEXTRACT_ENABLED !== "false",
    preextractConcurrency: Math.max(1, parseIntegerEnv(process.env.YOUTUBE_PREEXTRACT_CONCURRENCY, 1)),
    preextractMaxPerCardSet: Math.max(1, parseIntegerEnv(process.env.YOUTUBE_PREEXTRACT_MAX_PER_CARD_SET, 3)),
    // yt-dlp player_client(s) used for extraction. Empty (default) lets yt-dlp
    // pick its own clients — its maintainers track YouTube's rollout of
    // PO-token enforcement per client, so pinning is a liability: the pinned
    // 'tv' client started returning 403 stream URLs on 2026-07-01 (no GVS PO
    // token). Set explicitly (e.g. 'tv,ios') only for experiments; pinned
    // clients skip the nsig JS solve and extract faster, but break whenever
    // YouTube tightens that client.
    playerClient: (process.env.YOUTUBE_PLAYER_CLIENT ?? "").trim(),
    // bgutil PO-token provider (sidecar container). When set, every yt-dlp
    // invocation carries the bgutil-http extractor arg so stream URLs come
    // back PO-token'd — YouTube enforces GVS PO tokens per client and
    // extended them to the tv client on 2026-07-01 (403 storm incident).
    potProviderUrl: (process.env.YTDLP_POT_PROVIDER_URL ?? "").trim(),
    // Persistent on-disk cache of downloaded audio for replayed videos — a hit
    // plays from a local file (instant, no yt-dlp, no signed-URL expiry).
    mediaCacheEnabled: process.env.YOUTUBE_MEDIA_CACHE_ENABLED !== "false",
    mediaCacheDir: process.env.YOUTUBE_MEDIA_CACHE_DIR || "/app/cache",
    mediaCacheMaxEntries: Math.max(1, parseIntegerEnv(process.env.YOUTUBE_MEDIA_CACHE_MAX_ENTRIES, 200)),
    mediaCacheMaxBytes: Math.max(1, parseIntegerEnv(process.env.YOUTUBE_MEDIA_CACHE_MAX_MB, 1024)) * 1024 * 1024,
    cookieRefresh: {
      enabled: process.env.YOUTUBE_COOKIE_AUTO_REFRESH_ENABLED !== "false",
      cookiesFile: process.env.YOUTUBE_COOKIES_FILE || "/app/secrets/youtube_cookies.txt",
      browserSpec: process.env.YOUTUBE_COOKIE_BROWSER_SPEC || "chrome+basictext:/app/youtube-browser-profile",
      refreshIntervalMs: Math.max(0, parseIntegerEnv(process.env.YOUTUBE_COOKIE_REFRESH_INTERVAL_MS, 6 * 60 * 60 * 1000)),
      cooldownMs: Math.max(0, parseIntegerEnv(process.env.YOUTUBE_COOKIE_REFRESH_COOLDOWN_MS, 5 * 60 * 1000)),
      validateUrls: parseListEnv(process.env.YOUTUBE_COOKIE_VALIDATE_URLS, [
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "https://www.youtube.com/watch?v=AUfXW1EdLew",
      ]),
    },
  },
  radio: {
    // /radio endless Hachimi playback. When false the command refuses to start.
    enabled: process.env.RADIO_ENABLED !== "false",
    // How many random candidates radio will try to extract before giving up on
    // fetching the next track (each attempt re-rolls a fresh random video).
    replenishMaxAttempts: parseIntegerEnv(process.env.RADIO_REPLENISH_MAX_ATTEMPTS, 3),
    // Every breakIntervalMinutes of radio uptime, the next track (after the
    // current one ends naturally) becomes a fixed, non-skippable "take a break"
    // video. Active in every guild; set RADIO_BREAK_ENABLED=false to disable.
    breakEnabled: process.env.RADIO_BREAK_ENABLED !== "false",
    breakIntervalMinutes: Math.max(1, parseIntegerEnv(process.env.RADIO_BREAK_INTERVAL_MIN, 10)),
    breakVideoUrl: process.env.RADIO_BREAK_VIDEO
      || "https://www.bilibili.com/video/BV1a4sFzwE8E",
  },
  dailyHachimi: {
    dataFile: process.env.DAILY_HACHIMI_DATA_FILE
      || path.join(process.cwd(), "data", "daily_hachimi.json"),
    historyFile: process.env.DAILY_HACHIMI_HISTORY_FILE
      || path.join(process.cwd(), "data", "daily_hachimi_history.json"),
    defaultTimezone: "America/Toronto",
    defaultCount: 1,
  },
  worldCup: {
    // Temporal feature: only active during the 2026 FIFA World Cup window.
    enabled: process.env.WORLD_CUP_ENABLED !== "false",
    startDate: process.env.WORLD_CUP_START || "2026-06-11",
    // Exclusive. Final is Jul 19; Jul 21 leaves margin so a late-finishing final
    // (past UTC midnight) still gets its full-time push before the feature sleeps.
    endDate: process.env.WORLD_CUP_END || "2026-07-21",
    sourceUrl: process.env.WORLD_CUP_SOURCE_URL
      || "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard",
    // 88看球 (88kanqiu) streams the World Cup free without a VPN; /match/3/live is
    // its dedicated World Cup hub, so messages link there as the primary watch-live
    // destination (ESPN match pages serve as stats links). The site has no public
    // API and blocks bots, so we link to the World Cup hub rather than per-match
    // pages (those aren't reliably mappable from our match data).
    // ?? not ||: setting the env var to "" deliberately disables the link.
    streamUrl: process.env.WORLD_CUP_STREAM_URL ?? "https://www.88kanqiu.tw/match/3/live",
    // Display name for the watch-live link, paired with streamUrl.
    streamLabel: process.env.WORLD_CUP_STREAM_LABEL || "88看球",
    livePollMs: Math.max(15000, parseIntegerEnv(process.env.WORLD_CUP_LIVE_POLL_MS, 15 * 1000)),
    idlePollMs: Math.max(60000, parseIntegerEnv(process.env.WORLD_CUP_IDLE_POLL_MS, 10 * 60 * 1000)),
    requestTimeoutMs: Math.max(1000, parseIntegerEnv(process.env.WORLD_CUP_REQUEST_TIMEOUT_MS, 10000)),
    dataDir: process.env.WORLD_CUP_DATA_DIR || path.join(process.cwd(), "data", "world_cup"),
    timezone: process.env.WORLD_CUP_TIMEZONE || "America/Toronto",
  },
  annoying: {
    // /annoying anti-disconnect mode. The exempt user may still disconnect/move
    // the bot normally; everyone else gets fought. The value is a numeric
    // Discord user ID (preferred) or username, injected via the
    // ANNOYING_EXEMPT_USER secret at deploy time — never committed.
    exemptUser: (process.env.ANNOYING_EXEMPT_USER ?? "").trim(),
    // Small delay before rejoining — avoids racing Discord's own state
    // propagation and doubles as the rate limiter for spam-disconnects.
    rejoinDelayMs: Math.max(0, parseIntegerEnv(process.env.ANNOYING_REJOIN_DELAY_MS, 1500)),
  },
  resume: {
    // Resume interrupted playback after a restart/redeploy. A snapshot of every
    // actively-playing guild is written on graceful shutdown (SIGTERM from
    // `docker compose up -d`), flushed periodically while playing, and consumed
    // on the next startup.
    enabled: process.env.RESUME_ENABLED !== "false",
    dataFile: process.env.RESUME_DATA_FILE
      || path.join(process.cwd(), "data", "resume_state.json"),
    // After a long outage the channel has moved on — barging back in mid-song
    // would be noise. Default covers a normal deploy (~2-5 min) with margin.
    maxAgeMs: Math.max(0, parseIntegerEnv(process.env.RESUME_MAX_AGE_MS, 15 * 60 * 1000)),
    // Periodic flush so a hard kill / crash (not just a graceful SIGTERM) still
    // leaves a fresh file to resume from. Set to 0 to flush only at shutdown.
    snapshotIntervalMs: Math.max(0, parseIntegerEnv(process.env.RESUME_SNAPSHOT_INTERVAL_MS, 15 * 1000)),
  },
  test: {
    mode: process.env.TEST_MODE === "true",
    guildId: process.env.TEST_GUILD_ID,
  },
};

export = config;
