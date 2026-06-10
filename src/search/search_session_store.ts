/**
 * Search Session Store
 * Short-lived in-memory store for paginated search results. Each /search or
 * /play keyword search stores its full result list under a random token; the
 * page buttons and select menu reference the token in their customIds.
 */

import crypto = require('crypto');

type SearchSessionPlatform = 'bilibili' | 'youtube';
type SearchSessionMode = SearchSessionPlatform | 'dual';

interface SearchSessionEntry {
  platform: SearchSessionPlatform;
  title: string;
  uploader: string;
  /** Duration in seconds, or a preformatted string from the search source. */
  duration?: string | number;
  viewCount?: number;
  /** Direct video URL used when the selection value is an index fallback. */
  url: string | null;
  /** Select-menu option value: "bili:<id>" / "yt:<id>" / "idx_<n>" fallback. */
  selectionValue: string;
}

interface SearchSession {
  keyword: string;
  mode: SearchSessionMode;
  entries: SearchSessionEntry[];
  currentPage: number;
  createdAt: number;
}

type NewSearchSession = Omit<SearchSession, 'currentPage' | 'createdAt'>;

// 15 minutes — matches the lifetime of the ephemeral interaction the
// search message lives on; after that the message's components are dead anyway.
const SESSION_TTL_MS = 15 * 60 * 1000;
const MAX_SESSIONS = 200;

const sessions = new Map<string, SearchSession>();

function isExpired(session: SearchSession, now: number): boolean {
  return now - session.createdAt > SESSION_TTL_MS;
}

function evictStale(now: number): void {
  for (const [token, session] of sessions) {
    if (isExpired(session, now)) sessions.delete(token);
  }
}

function create(session: NewSearchSession): string {
  const now = Date.now();
  evictStale(now);
  const token = crypto.randomBytes(5).toString('hex');
  sessions.set(token, { ...session, currentPage: 1, createdAt: now });
  // Map iteration is insertion-ordered, so dropping from the front evicts oldest.
  while (sessions.size > MAX_SESSIONS) {
    const oldest = sessions.keys().next().value as string;
    sessions.delete(oldest);
  }
  return token;
}

function get(token: string): SearchSession | null {
  const session = sessions.get(token);
  if (!session) return null;
  if (isExpired(session, Date.now())) {
    sessions.delete(token);
    return null;
  }
  return session;
}

/** Test helper: drop all sessions. */
function clear(): void {
  sessions.clear();
}

export = {
  SESSION_TTL_MS,
  MAX_SESSIONS,
  create,
  get,
  clear,
};
