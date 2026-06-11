/**
 * WorldCupSource
 * Fetches World Cup fixtures + live scores by reading ESPN's public scoreboard
 * JSON (no login, no API key) — the same data backing a public site, far more
 * robust than scraping FIFA.com's JS-rendered HTML. The HTTP getter is injectable
 * so the crawl target can be swapped (or stubbed in tests) without touching the
 * rest of the feature.
 *
 * On any HTTP/parse failure `fetchMatchesForDate` THROWS — callers decide how to
 * degrade (the service records poller health; commands show a friendly error).
 */

import axios from 'axios';
import * as logger from '../services/logger_service';
import type { Match, MatchStatus, MatchSide } from './types';

interface HttpGetConfig {
  params: Record<string, string>;
  timeout: number;
  headers: Record<string, string>;
}
type HttpGet = (url: string, cfg: HttpGetConfig) => Promise<{ data: unknown }>;

interface WorldCupSourceOptions {
  baseUrl: string;
  timeoutMs: number;
  /** Defaults to axios.get; override in tests. */
  httpGet?: HttpGet;
}

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function mapStatus(state: unknown): MatchStatus {
  if (state === 'in') return 'live';
  if (state === 'post') return 'final';
  return 'scheduled';
}

function toScore(raw: unknown): number {
  const n = Number.parseInt(String(raw ?? ''), 10);
  return Number.isFinite(n) ? n : 0;
}

class WorldCupSource {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly httpGet: HttpGet;

  constructor(opts: WorldCupSourceOptions) {
    this.baseUrl = opts.baseUrl;
    this.timeoutMs = opts.timeoutMs;
    this.httpGet = opts.httpGet ?? ((url, cfg) => axios.get(url, cfg));
  }

  /**
   * Fetch all matches for a given date (YYYYMMDD, UTC). Throws on HTTP/parse
   * failure; returns `[]` only when the source genuinely lists no matches.
   */
  async fetchMatchesForDate(yyyymmdd: string): Promise<Match[]> {
    const res = await this.httpGet(this.baseUrl, {
      params: { dates: yyyymmdd },
      timeout: this.timeoutMs,
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    });

    const data = res?.data as { events?: unknown[] } | undefined;
    const events = Array.isArray(data?.events) ? data!.events : [];

    const matches: Match[] = [];
    for (const ev of events) {
      const parsed = this.parseEvent(ev);
      if (parsed) matches.push(parsed);
    }
    return matches;
  }

  /** Normalize one ESPN event → Match; returns null for malformed events. */
  private parseEvent(ev: unknown): Match | null {
    try {
      const e = ev as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
      const comp = e.competitions?.[0];
      const competitors: any[] = comp?.competitors ?? []; // eslint-disable-line @typescript-eslint/no-explicit-any
      const homeC = competitors.find((c) => c?.homeAway === 'home');
      const awayC = competitors.find((c) => c?.homeAway === 'away');
      if (!e.id || !homeC || !awayC) return null;

      const statusType = e.status?.type ?? {};
      const side = (c: any): MatchSide => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
        name: c.team?.displayName || c.team?.shortDisplayName || c.team?.abbreviation || 'TBD',
        abbrev: c.team?.abbreviation || '',
        score: toScore(c.score),
      });

      return {
        id: String(e.id),
        utcDate: String(e.date ?? ''),
        status: mapStatus(statusType.state),
        detail: String(statusType.detail || statusType.description || ''),
        clock: String(e.status?.displayClock || ''),
        home: side(homeC),
        away: side(awayC),
        group: String(comp?.notes?.[0]?.headline || ''),
        venue: String(comp?.venue?.fullName || ''),
        link: String(
          (Array.isArray(e.links) && e.links[0]?.href)
            || `https://www.espn.com/soccer/match/_/gameId/${e.id}`,
        ),
      };
    } catch (err: unknown) {
      logger.warn('WorldCupSource: failed to parse an event, skipping', {
        error: (err as Error).message,
      });
      return null;
    }
  }
}

export = WorldCupSource;
