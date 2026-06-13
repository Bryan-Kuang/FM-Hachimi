/**
 * WorldCupService
 * Temporal feature: during the World Cup window it polls a public source
 * (WorldCupSource → ESPN JSON), diffs successive polls to detect kickoff / goal /
 * full-time events, and pushes them to each guild's subscribed channel. On-demand
 * commands (/worldcup today|schedule) read through `getMatchesForDate`, which is
 * INDEPENDENT of the poller — it works even when the live poller is dead/stalled,
 * making the commands a reliable manual fallback.
 *
 * Mirrors DailyHachimiService (per-guild config + JSON persistence + proactive
 * posts) and the cookie-refresh background-service pattern. State is persisted so
 * a restart never re-posts events that already fired.
 */

import * as fs from 'fs';
import * as path from 'path';
import { EmbedBuilder } from 'discord.js';
import * as logger from '../services/logger_service';
import ExpiringCache = require('../utils/expiring_cache');
import WcEmbeds = require('./embeds');
import type WorldCupSource from './source';
import type {
  Match,
  MatchSnapshot,
  GuildSubscription,
  EventKind,
  WorldCupHealth,
  WorldCupServiceConfig,
} from './types';

// Minimal discord.js shapes needed at runtime.
interface TextBasedChannel {
  isTextBased(): boolean;
  send(options: { embeds: EmbedBuilder[] }): Promise<unknown>;
}
interface DiscordClient {
  channels: { fetch(id: string): Promise<TextBasedChannel | null> };
}

interface DetectedEvent {
  match: Match;
  kind: EventKind;
}

const FAILURE_BACKOFF_THRESHOLD = 3;

class WorldCupService {
  private readonly config: WorldCupServiceConfig;
  private readonly source: WorldCupSource;
  private client: DiscordClient | null;

  private subscriptions: Record<string, GuildSubscription>;
  private lastState: Map<string, MatchSnapshot>;
  private readonly cache: ExpiringCache<Match[]>;

  private pollTimer: ReturnType<typeof setTimeout> | null;
  private stopped: boolean;
  private hadAnyLive: boolean;
  /** Next upcoming kickoff seen in the last poll (ms epoch; 0 = none). */
  private nextKickoffAt: number;

  private health: { lastOkAt: number; lastError: string | null; consecutiveFailures: number };

  /** Formats a timestamp as YYYY-MM-DD in the configured timezone. */
  private readonly dayFormatter: Intl.DateTimeFormat;

  private readonly subsFile: string;
  private readonly stateFile: string;

  constructor(config: WorldCupServiceConfig, source: WorldCupSource) {
    this.config = config;
    this.source = source;
    this.client = null;

    this.subscriptions = {};
    this.lastState = new Map();
    this.cache = new ExpiringCache<Match[]>(60 * 1000, 8, { label: 'world_cup_dates', cleanupIntervalMs: 5 * 60 * 1000 });

    this.pollTimer = null;
    this.stopped = false;
    this.hadAnyLive = false;
    this.nextKickoffAt = 0;
    this.health = { lastOkAt: 0, lastError: null, consecutiveFailures: 0 };

    const dayFormat: Intl.DateTimeFormatOptions = { year: 'numeric', month: '2-digit', day: '2-digit' };
    try {
      this.dayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone, ...dayFormat });
    } catch {
      logger.warn('WorldCup: invalid timezone, falling back to UTC', { timezone: config.timezone });
      this.dayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', ...dayFormat });
    }

    this.subsFile = path.join(config.dataDir, 'subscriptions.json');
    this.stateFile = path.join(config.dataDir, 'state.json');
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  initialize(client: DiscordClient): void {
    this.client = client;
    this._ensureDir();
    this._loadSubscriptions();
    this._loadState();
    if (this.config.enabled) this.start();
    logger.info('WorldCupService initialized', {
      subscriptions: Object.keys(this.subscriptions).length,
      active: this.isActive(),
      trackedMatches: this.lastState.size,
    });
  }

  start(): void {
    if (!this.config.enabled || this.pollTimer) return;
    this.stopped = false;
    this._scheduleNextPoll(0); // first tick ~immediately
  }

  stop(): void {
    this.stopped = true;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    this.cache.dispose();
  }

  // ---------------------------------------------------------------------------
  // Subscriptions (per-guild live-update channel)
  // ---------------------------------------------------------------------------

  setSubscription(guildId: string, channelId: string): void {
    this.subscriptions[guildId] = { channelId };
    this._saveSubscriptions();
    logger.info('World Cup subscription set', { guildId, channelId });
  }

  removeSubscription(guildId: string): void {
    delete this.subscriptions[guildId];
    this._saveSubscriptions();
    logger.info('World Cup subscription removed', { guildId });
  }

  getSubscription(guildId: string): GuildSubscription | null {
    return this.subscriptions[guildId] ?? null;
  }

  // ---------------------------------------------------------------------------
  // Window gate + health
  // ---------------------------------------------------------------------------

  isActive(now: number = Date.now()): boolean {
    if (!this.config.enabled) return false;
    const start = Date.parse(`${this.config.startDate}T00:00:00Z`);
    const end = Date.parse(`${this.config.endDate}T00:00:00Z`);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
    return now >= start && now < end;
  }

  getWindow(): { startDate: string; endDate: string; active: boolean } {
    return { startDate: this.config.startDate, endDate: this.config.endDate, active: this.isActive() };
  }

  /** Free live-stream destination for message links (empty = no stream link). */
  getStreamUrl(): string {
    return this.config.streamUrl || '';
  }

  getHealth(): WorldCupHealth {
    const active = this.isActive();
    // Tolerate the slow (idle) cadence so status isn't falsely "degraded" between
    // 10-min idle polls; ~2 idle cycles of staleness = a genuinely stuck poller.
    const fresh = this.health.lastOkAt > 0 && Date.now() - this.health.lastOkAt < this.config.idlePollMs * 2;
    return {
      healthy: active && fresh,
      active,
      lastOkAt: this.health.lastOkAt,
      lastError: this.health.lastError,
      consecutiveFailures: this.health.consecutiveFailures,
    };
  }

  // ---------------------------------------------------------------------------
  // On-demand reads (the backup path — independent of the poller)
  // ---------------------------------------------------------------------------

  /**
   * Matches whose kickoff falls on the given calendar day (YYYYMMDD, in the
   * configured timezone), cached ~60s. Throws if the source fails.
   *
   * The source groups its scoreboard by ITS OWN calendar day (ESPN uses US
   * Eastern), which rarely lines up with ours — e.g. the Jun 11 22:00 ET
   * kickoff is 02:00 UTC Jun 12 and sits on ESPN's Jun 11 board. So one local
   * day can span two boards: fetch the adjacent boards too and filter by each
   * match's own kickoff time instead of trusting the board it came from.
   */
  async getMatchesForDate(yyyymmdd: string): Promise<Match[]> {
    const cached = this.cache.get(yyyymmdd);
    if (cached) return cached;
    const all = await this._fetchBoards([this._shiftDay(yyyymmdd, -1), yyyymmdd, this._shiftDay(yyyymmdd, 1)]);
    const matches = all.filter((m) => {
      const t = Date.parse(m.utcDate);
      // Keep matches with unparseable dates rather than risk hiding them.
      return Number.isFinite(t) ? this._dayKey(t) === yyyymmdd : true;
    });
    this.cache.set(yyyymmdd, matches);
    return matches;
  }

  /** Today's matches (in the configured timezone). Throws if the source fails. */
  async getToday(): Promise<Match[]> {
    return this.getMatchesForDate(this._todayKey(0));
  }

  // ---------------------------------------------------------------------------
  // Live poller
  // ---------------------------------------------------------------------------

  private _scheduleNextPoll(delayMs: number): void {
    if (this.stopped) return;
    this.pollTimer = setTimeout(() => {
      this.pollOnce()
        .catch((err: unknown) => logger.error('WorldCup pollOnce threw', { error: (err as Error).message }))
        .finally(() => this._scheduleNextPoll(this._nextDelay()));
    }, delayMs);
    this.pollTimer.unref?.();
  }

  private _nextDelay(): number {
    if (!this.isActive()) return this.config.idlePollMs;
    if (this.health.consecutiveFailures >= FAILURE_BACKOFF_THRESHOLD) return this.config.idlePollMs;
    if (this.hadAnyLive) return this.config.livePollMs;
    // No live match yet: wake at the next kickoff (then live cadence while it's
    // due-but-not-started) instead of idling a full cycle through it — an idle
    // cycle is long enough to miss a kickoff and the first goals entirely.
    if (this.nextKickoffAt > 0) {
      const untilKickoff = this.nextKickoffAt - Date.now();
      return Math.min(this.config.idlePollMs, Math.max(this.config.livePollMs, untilKickoff));
    }
    return this.config.idlePollMs;
  }

  /**
   * One poll: fetch today+tomorrow, diff against last state, push detected events
   * to subscribers, persist state. Safe to call directly (tests do).
   */
  async pollOnce(): Promise<void> {
    if (!this.isActive()) return;

    let matches: Match[];
    try {
      matches = await this._fetchWindow();
      this.health.lastOkAt = Date.now();
      this.health.lastError = null;
      this.health.consecutiveFailures = 0;
    } catch (err: unknown) {
      this.health.consecutiveFailures += 1;
      this.health.lastError = (err as Error).message;
      logger.warn('WorldCup poll failed; commands remain available as fallback', {
        error: (err as Error).message,
        consecutiveFailures: this.health.consecutiveFailures,
      });
      return;
    }

    this.hadAnyLive = matches.some((m) => m.status === 'live');
    this.nextKickoffAt = this._nextKickoff(matches);
    const { events, changed } = this._diff(matches);
    if (changed) this._saveState();
    if (events.length > 0) await this._broadcast(events);
  }

  /** Diff matches against lastState; returns detected events + whether state changed. */
  private _diff(matches: Match[]): { events: DetectedEvent[]; changed: boolean } {
    const events: DetectedEvent[] = [];
    let changed = false;

    for (const m of matches) {
      const prev = this.lastState.get(m.id);
      const snap: MatchSnapshot = { status: m.status, homeScore: m.home.score, awayScore: m.away.score };

      if (!prev) {
        // First sighting (incl. after a restart for a never-seen match): seed
        // silently so we don't replay historical kickoffs/goals as if live.
        this.lastState.set(m.id, snap);
        changed = true;
        continue;
      }

      if (prev.status === 'scheduled' && m.status === 'live') {
        events.push({ match: m, kind: 'kickoff' });
      }
      // One event per scoring side so simultaneous goals each get a push.
      if (m.home.score > prev.homeScore) events.push({ match: m, kind: 'goal' });
      if (m.away.score > prev.awayScore) events.push({ match: m, kind: 'goal' });
      if (prev.status !== 'final' && m.status === 'final') {
        events.push({ match: m, kind: 'fulltime' });
      }

      if (prev.status !== snap.status || prev.homeScore !== snap.homeScore || prev.awayScore !== snap.awayScore) {
        this.lastState.set(m.id, snap);
        changed = true;
      }
    }

    return { events, changed };
  }

  private async _broadcast(events: DetectedEvent[]): Promise<void> {
    if (!this.client) return;
    for (const guildId of Object.keys(this.subscriptions)) {
      const channelId = this.subscriptions[guildId].channelId;
      const channel = await this._fetchChannel(channelId);
      if (!channel) continue;
      for (const ev of events) {
        try {
          const embed = WcEmbeds.buildEventEmbed(ev.match, ev.kind, this.config.streamUrl);
          await channel.send({ embeds: [embed] });
        } catch (err: unknown) {
          logger.error('WorldCup: failed to post live event', {
            guildId,
            channelId,
            matchId: ev.match.id,
            error: (err as Error).message,
          });
        }
      }
    }
  }

  private async _fetchChannel(channelId: string): Promise<TextBasedChannel | null> {
    try {
      const channel = await this.client!.channels.fetch(channelId);
      if (!channel || !channel.isTextBased()) {
        logger.warn('WorldCup: subscribed channel missing or not text-based', { channelId });
        return null;
      }
      return channel;
    } catch (err: unknown) {
      logger.error('WorldCup: failed to fetch subscribed channel', {
        channelId,
        error: (err as Error).message,
      });
      return null;
    }
  }

  /**
   * Fetch yesterday + today + tomorrow boards, de-duped by match id. Yesterday
   * matters: a match that kicked off late on the source's previous calendar day
   * (see getMatchesForDate) is still live now and must stay in the diff window.
   */
  private async _fetchWindow(): Promise<Match[]> {
    return this._fetchBoards([this._todayKey(-1), this._todayKey(0), this._todayKey(1)]);
  }

  /** Fetch several scoreboard days in parallel, concatenated and de-duped by match id. */
  private async _fetchBoards(days: string[]): Promise<Match[]> {
    const boards = await Promise.all(days.map((d) => this.source.fetchMatchesForDate(d)));
    const seen = new Set<string>();
    const all: Match[] = [];
    for (const ms of boards) {
      for (const m of ms) {
        if (!seen.has(m.id)) {
          seen.add(m.id);
          all.push(m);
        }
      }
    }
    return all;
  }

  /**
   * Earliest kickoff worth waking up for (ms epoch; 0 = none): the soonest
   * scheduled match, including ones already due but not flipped to live yet.
   * Kickoffs more than 2h overdue are treated as postponed and ignored so a
   * stale fixture can't pin the poller at live cadence all day.
   */
  private _nextKickoff(matches: Match[], now: number = Date.now()): number {
    let next = 0;
    for (const m of matches) {
      if (m.status !== 'scheduled') continue;
      const t = Date.parse(m.utcDate);
      if (!Number.isFinite(t) || t < now - 2 * 60 * 60 * 1000) continue;
      if (next === 0 || t < next) next = t;
    }
    return next;
  }

  /** YYYYMMDD for a timestamp in the configured timezone. */
  private _dayKey(t: number): string {
    return this.dayFormatter.format(t).replace(/-/g, '');
  }

  private _todayKey(offsetDays: number): string {
    return this._shiftDay(this._dayKey(Date.now()), offsetDays);
  }

  /** Shift a YYYYMMDD day key by whole days (pure calendar arithmetic). */
  private _shiftDay(yyyymmdd: string, offsetDays: number): string {
    const base = Date.UTC(
      Number(yyyymmdd.slice(0, 4)),
      Number(yyyymmdd.slice(4, 6)) - 1,
      Number(yyyymmdd.slice(6, 8)),
    );
    const d = new Date(base + offsetDays * 24 * 60 * 60 * 1000);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}${m}${day}`;
  }

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  private _ensureDir(): void {
    try {
      fs.mkdirSync(this.config.dataDir, { recursive: true });
    } catch (err: unknown) {
      logger.error('WorldCup: failed to create data dir', {
        dir: this.config.dataDir,
        error: (err as Error).message,
      });
    }
  }

  private _loadSubscriptions(): void {
    try {
      if (fs.existsSync(this.subsFile)) {
        this.subscriptions = JSON.parse(fs.readFileSync(this.subsFile, 'utf8')) as Record<string, GuildSubscription>;
      }
    } catch (err: unknown) {
      logger.warn('WorldCup: failed to load subscriptions, starting fresh', { error: (err as Error).message });
      this.subscriptions = {};
    }
  }

  private _loadState(): void {
    try {
      if (fs.existsSync(this.stateFile)) {
        const raw = JSON.parse(fs.readFileSync(this.stateFile, 'utf8')) as Record<string, MatchSnapshot>;
        this.lastState = new Map(Object.entries(raw));
      }
    } catch (err: unknown) {
      logger.warn('WorldCup: failed to load match state, starting fresh', { error: (err as Error).message });
      this.lastState = new Map();
    }
  }

  private _saveSubscriptions(): void {
    this._atomicWrite(this.subsFile, JSON.stringify(this.subscriptions, null, 2));
  }

  private _saveState(): void {
    const obj = Object.fromEntries(this.lastState.entries());
    this._atomicWrite(this.stateFile, JSON.stringify(obj, null, 2));
  }

  private _atomicWrite(file: string, contents: string): void {
    const tmp = `${file}.tmp`;
    try {
      this._ensureDir();
      fs.writeFileSync(tmp, contents, 'utf8');
      fs.renameSync(tmp, file);
    } catch (err: unknown) {
      try { fs.unlinkSync(tmp); } catch { /* ignore */ }
      logger.error('WorldCup: failed to persist file', { file, error: (err as Error).message });
    }
  }
}

export = WorldCupService;
