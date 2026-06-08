/**
 * Shared World Cup types. Kept in their own module because the source/service
 * use the CommonJS `export =` class pattern, which can't co-exist with named
 * type exports in the same file.
 */

export type MatchStatus = 'scheduled' | 'live' | 'final';

export interface MatchSide {
  name: string;
  abbrev: string;
  score: number;
}

export interface Match {
  id: string;
  /** Kickoff time, ISO-8601 UTC. */
  utcDate: string;
  status: MatchStatus;
  /** Human status detail, e.g. "FT", "45'", or a kickoff time string. */
  detail: string;
  /** Live clock display, e.g. "67'" (empty when not live). */
  clock: string;
  home: MatchSide;
  away: MatchSide;
  /** Group/round label, e.g. "Group A" (best-effort; may be empty). */
  group: string;
  venue: string;
}

/** Persisted per-match snapshot used to diff successive polls. */
export interface MatchSnapshot {
  status: MatchStatus;
  homeScore: number;
  awayScore: number;
}

export interface GuildSubscription {
  channelId: string;
}

export type EventKind = 'kickoff' | 'goal' | 'fulltime';

/** The subset of config the service needs (config.worldCup is a structural superset). */
export interface WorldCupServiceConfig {
  enabled: boolean;
  startDate: string;
  endDate: string;
  livePollMs: number;
  idlePollMs: number;
  dataDir: string;
  timezone: string;
}

export interface WorldCupHealth {
  healthy: boolean;
  active: boolean;
  lastOkAt: number;
  lastError: string | null;
  consecutiveFailures: number;
}
