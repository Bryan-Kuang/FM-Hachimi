/**
 * Stream URL reachability probe.
 *
 * An extractor returning a URL only proves it *found* a format — not that the
 * URL still serves bytes. Those are different claims, and the gap between them
 * caused the 2026-08-08 outage: yt-dlp's mweb client happily produced
 * googlevideo URLs that answered 403, so extraction "succeeded", the dead URL
 * went into the cache, and the first sign of trouble was FFmpeg failing
 * mid-track. Three CDN retries later the track was dropped.
 *
 * So: before a URL is cached or handed to FFmpeg, ask it for one byte. Cheap
 * (Range: bytes=0-0, short timeout, no body), and it turns a user-visible
 * "song starts, no sound, gets skipped" into a re-extract the listener never
 * sees.
 */

import axios from 'axios';
import * as logger from '../services/logger_service';
import config = require('../config/config');
import type { StreamHeaders } from '../types';

export interface ProbeResult {
  ok: boolean;
  /** HTTP status when the server answered; undefined on transport failure. */
  status?: number;
  /** Why the probe failed — status text or transport error message. */
  reason?: string;
  /** Probe wall time, for the timing logs. */
  durationMs: number;
}

/**
 * Probe a media URL. Never throws — an unreachable URL is a result, not an
 * exception. Local file paths (media-cache hits) are reported ok without a
 * request, since there is no server to ask.
 */
export async function probeStreamUrl(
  url: string,
  headers?: StreamHeaders,
): Promise<ProbeResult> {
  const startedAt = Date.now();

  if (!config.playback.streamProbeEnabled) {
    return { ok: true, durationMs: 0 };
  }
  // Only remote URLs have a server to answer. Mirrors the same check FFmpeg's
  // arg builder makes in audio_player.ts.
  if (!/^https?:\/\//i.test(url)) {
    return { ok: true, durationMs: 0 };
  }

  const requestHeaders: Record<string, string> = { Range: 'bytes=0-0' };
  if (headers?.referer) requestHeaders.Referer = headers.referer;
  if (headers?.userAgent) requestHeaders['User-Agent'] = headers.userAgent;

  try {
    const response = await axios.get(url, {
      headers: requestHeaders,
      timeout: config.playback.streamProbeTimeoutMs,
      maxRedirects: 5,
      responseType: 'stream',
      // Every status is a valid answer here; we classify it ourselves.
      validateStatus: () => true,
    });

    // responseType 'stream' means the body is still open — drop it, we only
    // wanted the status line.
    (response.data as { destroy?: () => void })?.destroy?.();

    const status = response.status;
    // 206 is the expected answer to a one-byte range; 200 means the server
    // ignored Range and would have sent the whole file.
    const ok = status >= 200 && status < 400;
    return {
      ok,
      status,
      reason: ok ? undefined : `HTTP ${status}`,
      durationMs: Date.now() - startedAt,
    };
  } catch (error: unknown) {
    return {
      ok: false,
      reason: (error as Error).message,
      durationMs: Date.now() - startedAt,
    };
  }
}

/**
 * Probe and log. Returns whether the URL is usable, so callers read as
 * `if (!await probeOrWarn(...)) { /* re-extract *\/ }`.
 */
export async function probeOrWarn(
  url: string,
  headers: StreamHeaders | undefined,
  context: { platform: string; sourceUrl?: string },
): Promise<boolean> {
  const result = await probeStreamUrl(url, headers);
  if (!result.ok) {
    logger.warn('Stream URL probe failed; extracted URL is not playable', {
      platform: context.platform,
      url: context.sourceUrl,
      status: result.status,
      reason: result.reason,
      probeMs: result.durationMs,
    });
  } else if (result.durationMs > 0) {
    logger.debug('Stream URL probe passed', {
      platform: context.platform,
      status: result.status,
      probeMs: result.durationMs,
    });
  }
  return result.ok;
}
