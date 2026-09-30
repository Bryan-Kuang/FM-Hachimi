/**
 * URL Router
 * Dispatches URLs to the appropriate platform extractor.
 * Rejects unsupported URLs and uses keyword search for plain text.
 */

import BilibiliValidator = require('../bilibili/validator');
import YouTubeValidator = require('../youtube/validator');
import * as logger from '../services/logger_service';

export type Platform = 'bilibili' | 'youtube' | 'unknown';

export type RouteKind =
  | 'bilibili-video'
  | 'youtube-video'
  | 'unknown-url'
  | 'keyword';

export interface RouteResult {
  platform: Platform;
  isUrl: boolean;
  /** Normalized URL (null if input is a keyword, not a URL) */
  normalizedUrl: string | null;
  /** Original input */
  raw: string;
  /** Single-video, unsupported URL or keyword classification. */
  kind: RouteKind;
}

/**
 * Determine which platform a URL belongs to, or mark it as a keyword search.
 */
export function routeQuery(query: string): RouteResult {
  if (!query || typeof query !== 'string') {
    return { platform: 'unknown', isUrl: false, normalizedUrl: null, raw: query, kind: 'keyword' };
  }

  const trimmed = query.trim();

  // Check Bilibili first (existing primary platform)
  if (BilibiliValidator.isValidBilibiliUrl(trimmed)) {
    return {
      platform: 'bilibili',
      isUrl: true,
      normalizedUrl: BilibiliValidator.normalizeUrl(trimmed),
      raw: trimmed,
      kind: 'bilibili-video',
    };
  }

  // Check YouTube
  if (YouTubeValidator.isValidYouTubeUrl(trimmed)) {
    return {
      platform: 'youtube',
      isUrl: true,
      normalizedUrl: YouTubeValidator.normalizeUrl(trimmed),
      raw: trimmed,
      kind: 'youtube-video',
    };
  }

  // Looks like a URL but doesn't match any platform
  if (/^(?:https?:\/\/|(?:[a-z0-9-]+\.)*(?:bilibili\.com|youtube\.com|youtu\.be|b23\.tv|discordapp\.(?:com|net))\/)/i.test(trimmed)) {
    logger.warn('URL does not match any supported platform', { url: trimmed });
    return { platform: 'unknown', isUrl: true, normalizedUrl: null, raw: trimmed, kind: 'unknown-url' };
  }

  // Keyword search (not a URL)
  return { platform: 'unknown', isUrl: false, normalizedUrl: null, raw: trimmed, kind: 'keyword' };
}
