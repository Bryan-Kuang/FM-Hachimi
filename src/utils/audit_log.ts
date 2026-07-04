/**
 * Audit-log culprit lookup
 * Finds the user who just performed a moderation action (member disconnect /
 * move) from the guild's audit log. Requires the bot to have the View Audit
 * Log permission; resolves to null when the entry or permission is missing.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import * as logger from '../services/logger_service';

interface FindExecutorOptions {
  /** Ignore entries older than this (ms). */
  maxAgeMs?: number;
}

async function findRecentAuditExecutor(
  guild: any,
  type: number,
  options: FindExecutorOptions = {},
): Promise<any | null> {
  const maxAgeMs = options.maxAgeMs ?? 5000;

  try {
    const auditLogs: any = await guild.fetchAuditLogs({ type, limit: 5 });

    let mostRecent: any = null;
    for (const entry of auditLogs.entries.values()) {
      if (Date.now() - entry.createdTimestamp > maxAgeMs) continue;
      if (!mostRecent || entry.createdTimestamp > mostRecent.createdTimestamp) {
        mostRecent = entry;
      }
    }

    return mostRecent?.executor ?? null;
  } catch (err: unknown) {
    logger.debug('Failed to fetch audit logs for culprit lookup', {
      type,
      guildId: guild?.id,
      error: (err as Error).message,
    });
    return null;
  }
}

export = { findRecentAuditExecutor };
