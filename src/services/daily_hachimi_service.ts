/**
 * DailyHachimiService
 * 每日定时在指定频道发送哈基米音乐推荐卡片。
 * 每个 guild 独立配置，默认全部关闭，由管理员通过 /daily-hachimi 命令配置。
 */

import * as fs from 'fs';
import * as path from 'path';
import { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } from 'discord.js';
import * as logger from './logger_service';
import Formatters = require('../utils/formatters');

// node-cron ships no bundled types and @types/node-cron is not installed.
// Duck-type the minimal surface we need.
interface ScheduledTask {
  stop(): void;
}
interface CronModule {
  schedule(
    expression: string,
    task: () => void,
    options?: { timezone?: string },
  ): ScheduledTask;
}
// eslint-disable-next-line @typescript-eslint/no-var-requires
const cron = require('node-cron') as CronModule;

interface GuildScheduleConfig {
  channelId: string;
  hour: number;
  minute: number;
  count: number;
  timezone: string;
}

interface AppConfig {
  dailyHachimi?: {
    dataFile?: string;
    historyFile?: string;
    defaultTimezone?: string;
    defaultCount?: number;
  };
  [key: string]: unknown;
}

// Minimal discord.js channel shapes needed at runtime
interface TextBasedChannel {
  isTextBased(): boolean;
  send(options: string | { embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[] }): Promise<unknown>;
}
interface DiscordClient {
  channels: {
    fetch(id: string): Promise<TextBasedChannel | null>;
  };
}

interface VideoInfo {
  bvid?: string;
  title?: string;
  url?: string;
  pic?: string;
  duration: number;
  [key: string]: unknown;
}

interface BilibiliApi {
  searchHachimiVideos(
    count: number,
    guildId: string,
    options?: { excludeBvids?: string[]; fillFromExcluded?: boolean },
  ): Promise<{ results: VideoInfo[] }>;
}

type MonthlyRecommendationHistory = Record<string, Record<string, string[]>>;

interface PreExtractionServiceLike {
  prewarmBilibiliUrls(
    urls: string[],
    context: { source: 'daily_recommendation'; guildId?: string },
  ): unknown;
}

class DailyHachimiService {
  private config: AppConfig;
  private cronJobs: Map<string, ScheduledTask>;
  private schedules: Record<string, GuildScheduleConfig>;
  private client: DiscordClient | null;
  private bilibiliApi: BilibiliApi | null;
  private _dataFile: string;
  private _historyFile: string;
  private _recommendationHistory: MonthlyRecommendationHistory;
  private preExtractionService: PreExtractionServiceLike | null;

  constructor(config: AppConfig, preExtractionService: PreExtractionServiceLike | null = null) {
    this.config = config;
    this.cronJobs   = new Map();
    this.schedules  = {};
    this.client     = null;
    this.bilibiliApi = null;
    this._recommendationHistory = {};
    this.preExtractionService = preExtractionService;

    this._dataFile =
      config.dailyHachimi?.dataFile ??
      path.join(process.cwd(), 'data', 'daily_hachimi.json');
    this._historyFile =
      config.dailyHachimi?.historyFile ??
      path.join(process.cwd(), 'data', 'daily_hachimi_history.json');
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Initialize: store client/api references, load persisted schedules, start crons.
   */
  initialize(discordClient: DiscordClient, bilibiliApi: BilibiliApi): void {
    this.client     = discordClient;
    this.bilibiliApi = bilibiliApi;

    this._checkDataDirWritable();
    this._loadSchedules();
    this._loadRecommendationHistory();

    for (const [guildId, cfg] of Object.entries(this.schedules)) {
      this._scheduleGuild(guildId, cfg);
    }

    logger.info('DailyHachimiService initialized', {
      guildsScheduled: Object.keys(this.schedules).length,
    });
  }

  /**
   * Set or update a guild's daily schedule.
   */
  setSchedule(guildId: string, cfg: GuildScheduleConfig): void {
    this._stopCron(guildId);
    this.schedules[guildId] = cfg;
    this._saveSchedules();
    this._scheduleGuild(guildId, cfg);
    logger.info('Daily Hachimi schedule set', { guildId, ...cfg });
  }

  /**
   * Remove a guild's daily schedule.
   */
  removeSchedule(guildId: string): void {
    this._stopCron(guildId);
    delete this.schedules[guildId];
    this._saveSchedules();
    logger.info('Daily Hachimi schedule removed', { guildId });
  }

  /**
   * Get a guild's current schedule config, or null if not configured.
   */
  getStatus(guildId: string): GuildScheduleConfig | null {
    return this.schedules[guildId] ?? null;
  }

  // ---------------------------------------------------------------------------
  // Internal scheduling
  // ---------------------------------------------------------------------------

  private _scheduleGuild(guildId: string, cfg: GuildScheduleConfig): void {
    const { hour, minute, timezone } = cfg;
    const expression = `${minute} ${hour} * * *`;

    try {
      const task = cron.schedule(
        expression,
        () => {
          this._fire(guildId).catch((err: Error) => {
            logger.error('DailyHachimi _fire threw unexpected error', {
              guildId,
              error: err.message,
              stack: err.stack,
            });
          });
        },
        { timezone },
      );

      this.cronJobs.set(guildId, task);
      logger.debug('Daily Hachimi cron scheduled', { guildId, expression, timezone });
    } catch (err: unknown) {
      logger.error('Failed to schedule daily hachimi cron', {
        guildId,
        expression,
        timezone,
        error: (err as Error).message,
      });
    }
  }

  private _stopCron(guildId: string): void {
    const task = this.cronJobs.get(guildId);
    if (task) {
      task.stop();
      this.cronJobs.delete(guildId);
    }
  }

  // ---------------------------------------------------------------------------
  // Fire: send daily recommendation cards
  // ---------------------------------------------------------------------------

  private async _fire(guildId: string): Promise<void> {
    const cfg = this.schedules[guildId];
    if (!cfg) return;

    const { channelId, count } = cfg;
    logger.info('Firing daily Hachimi recommendation', { guildId, channelId, count });

    // Fetch the Discord channel
    let channel: TextBasedChannel | null = null;
    try {
      channel = await this.client!.channels.fetch(channelId);
    } catch (err: unknown) {
      logger.error('DailyHachimi: failed to fetch channel — disabling schedule', {
        guildId,
        channelId,
        error: (err as Error).message,
      });
      this._stopCron(guildId);
      delete this.schedules[guildId];
      this._persistSchedules();
      return;
    }

    if (!channel || !channel.isTextBased()) {
      logger.error('DailyHachimi: channel is not text-based — disabling schedule', { guildId, channelId });
      this._stopCron(guildId);
      delete this.schedules[guildId];
      this._persistSchedules();
      return;
    }

    const timezone = cfg.timezone || this.config.dailyHachimi?.defaultTimezone || 'America/Toronto';
    const monthKey = this._getMonthKey(timezone);
    this._pruneGuildHistory(guildId, monthKey);

    // Search for videos
    let videos: VideoInfo[] = [];
    try {
      const { results } = await this.bilibiliApi!.searchHachimiVideos(count, guildId, {
        excludeBvids: this._getMonthlyHistory(guildId, monthKey),
        fillFromExcluded: true,
      });
      videos = results;
    } catch (err: unknown) {
      logger.error('DailyHachimi: searchHachimiVideos threw', {
        guildId,
        error: (err as Error).message,
      });
      return;
    }

    if (!videos || videos.length === 0) {
      logger.warn('DailyHachimi: no videos returned by API, skipping send', { guildId });
      return;
    }

    // Format today's date
    const today = new Date().toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: timezone,
    });

    // Send header message
    try {
      await channel.send(`🎵 今日哈基米音乐推荐 · ${today}`);
    } catch (err: unknown) {
      logger.error('DailyHachimi: failed to send header message', {
        guildId,
        error: (err as Error).message,
      });
      return;
    }

    // Send one card per video
    const prewarmUrls: string[] = [];
    for (const video of videos) {
      try {
        const embed = this._buildVideoEmbed(video);
        const row   = this._buildActionRow(video);
        await channel.send({ embeds: [embed], components: [row] });
        const bvid = this._extractBvid(video);
        if (bvid) {
          this._recordMonthlyHistory(guildId, monthKey, bvid);
          prewarmUrls.push(video.url || `https://www.bilibili.com/video/${bvid}`);
        }
      } catch (err: unknown) {
        logger.error('DailyHachimi: failed to send video card', {
          guildId,
          bvid: video.bvid,
          error: (err as Error).message,
        });
        // Continue sending remaining cards
      }
    }

    if (prewarmUrls.length > 0) {
      this.preExtractionService?.prewarmBilibiliUrls(prewarmUrls, {
        source: 'daily_recommendation',
        guildId,
      });
    }

    logger.info('DailyHachimi: cards sent', { guildId, count: videos.length });
  }

  private _buildVideoEmbed(video: VideoInfo): EmbedBuilder {
    const durationStr = Formatters.formatInlineTimeHms(video.duration, '未知');

    const embed = new EmbedBuilder()
      .setColor(0x00B5FF) // Bilibili blue
      .setTitle(video.title || '未知标题')
      .setDescription(durationStr)
      .setURL(video.url || `https://www.bilibili.com/video/${video.bvid}`);

    if (video.pic) {
      // Bilibili returns protocol-relative URLs (//i0.hdslb.com/...).
      // Discord requires a full https:// URL.
      const picUrl = (video.pic as string).startsWith('//')
        ? `https:${video.pic}`
        : (video.pic as string);
      embed.setImage(picUrl);
    }

    return embed;
  }

  private _buildActionRow(video: VideoInfo): ActionRowBuilder<ButtonBuilder> {
    const bvid     = video.bvid || '';
    const videoUrl = video.url || `https://www.bilibili.com/video/${bvid}`;

    const listenBtn = new ButtonBuilder()
      .setCustomId(`daily_play_${bvid}`)
      .setLabel('立刻聆听')
      .setEmoji('▶️')
      .setStyle(ButtonStyle.Primary);

    const linkBtn = new ButtonBuilder()
      .setLabel('查看视频')
      .setEmoji('🔗')
      .setStyle(ButtonStyle.Link)
      .setURL(videoUrl);

    return new ActionRowBuilder<ButtonBuilder>().addComponents(listenBtn, linkBtn);
  }

  private _extractBvid(video: VideoInfo): string | null {
    if (video.bvid) return video.bvid;
    const match = /\/video\/(BV[0-9A-Za-z]+)/.exec(video.url || '');
    return match ? match[1] : null;
  }

  private _getMonthKey(timezone: string, date = new Date()): string {
    try {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
      }).formatToParts(date);
      const year = parts.find((part) => part.type === 'year')?.value;
      const month = parts.find((part) => part.type === 'month')?.value;
      if (year && month) return `${year}-${month}`;
    } catch (err: unknown) {
      logger.warn('DailyHachimi: invalid timezone for history month, using UTC', {
        timezone,
        error: (err as Error).message,
      });
    }
    return date.toISOString().slice(0, 7);
  }

  private _getMonthlyHistory(guildId: string, monthKey: string): string[] {
    return [...(this._recommendationHistory[guildId]?.[monthKey] || [])];
  }

  private _recordMonthlyHistory(guildId: string, monthKey: string, bvid: string): void {
    if (!this._recommendationHistory[guildId]) {
      this._recommendationHistory[guildId] = {};
    }
    const current = this._recommendationHistory[guildId][monthKey] || [];
    if (!current.includes(bvid)) {
      this._recommendationHistory[guildId][monthKey] = [...current, bvid];
      this._saveRecommendationHistory();
    }
  }

  private _pruneGuildHistory(guildId: string, monthKey: string): void {
    const guildHistory = this._recommendationHistory[guildId];
    if (!guildHistory) return;
    let changed = false;
    for (const existingMonth of Object.keys(guildHistory)) {
      if (existingMonth !== monthKey) {
        delete guildHistory[existingMonth];
        changed = true;
      }
    }
    if (changed) {
      this._saveRecommendationHistory();
    }
  }

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  private _loadSchedules(): void {
    try {
      if (fs.existsSync(this._dataFile)) {
        const raw = fs.readFileSync(this._dataFile, 'utf8');
        this.schedules = JSON.parse(raw) as Record<string, GuildScheduleConfig>;
        logger.debug('DailyHachimi schedules loaded', {
          count: Object.keys(this.schedules).length,
        });
      }
    } catch (err: unknown) {
      logger.warn('DailyHachimi: failed to load schedules file, starting fresh', {
        file: this._dataFile,
        error: (err as Error).message,
      });
      this.schedules = {};
    }
  }

  private _persistSchedules(): void {
    try {
      const dir = path.dirname(this._dataFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this._dataFile, JSON.stringify(this.schedules, null, 2), 'utf8');
      logger.debug('DailyHachimi schedules persisted', {
        count: Object.keys(this.schedules).length,
      });
    } catch (err: unknown) {
      logger.error('DailyHachimi: failed to persist schedules file', {
        file: this._dataFile,
        error: (err as Error).message,
      });
    }
  }

  private _loadRecommendationHistory(): void {
    try {
      if (!fs.existsSync(this._historyFile)) {
        this._recommendationHistory = {};
        return;
      }

      const raw = fs.readFileSync(this._historyFile, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      this._recommendationHistory = this._normalizeRecommendationHistory(parsed);
    } catch (err: unknown) {
      logger.warn('DailyHachimi: failed to load recommendation history file, starting fresh', {
        file: this._historyFile,
        error: (err as Error).message,
      });
      this._recommendationHistory = {};
    }
  }

  private _normalizeRecommendationHistory(value: unknown): MonthlyRecommendationHistory {
    const normalized: MonthlyRecommendationHistory = {};
    if (!value || typeof value !== 'object') return normalized;

    for (const [guildId, months] of Object.entries(value as Record<string, unknown>)) {
      if (!months || typeof months !== 'object') continue;
      for (const [monthKey, bvids] of Object.entries(months as Record<string, unknown>)) {
        if (!/^\d{4}-\d{2}$/.test(monthKey) || !Array.isArray(bvids)) continue;
        const cleanBvids = [...new Set(bvids.filter((bvid): bvid is string => typeof bvid === 'string' && bvid.length > 0))];
        if (cleanBvids.length === 0) continue;
        if (!normalized[guildId]) normalized[guildId] = {};
        normalized[guildId][monthKey] = cleanBvids;
      }
    }

    return normalized;
  }

  private _saveRecommendationHistory(): void {
    try {
      const dir = path.dirname(this._historyFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(
        this._historyFile,
        JSON.stringify(this._recommendationHistory, null, 2),
        'utf8',
      );
    } catch (err: unknown) {
      logger.warn('DailyHachimi: failed to save recommendation history', {
        file: this._historyFile,
        error: (err as Error).message,
      });
    }
  }

  private _saveSchedules(): void {
    try {
      const dir = path.dirname(this._dataFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this._dataFile, JSON.stringify(this.schedules, null, 2), 'utf8');
    } catch (err: unknown) {
      logger.error('DailyHachimi: failed to save schedules', {
        file: this._dataFile,
        error: (err as Error).message,
      });
      throw err;
    }
  }

  private _checkDataDirWritable(): void {
    const dir = path.dirname(this._dataFile);
    try {
      fs.accessSync(dir, fs.constants.W_OK);
    } catch (err: unknown) {
      logger.error(
        'DailyHachimi: data dir not writable, /daily-hachimi setup will fail',
        { dir, error: (err as Error).message },
      );
    }
  }
}

export = DailyHachimiService;
