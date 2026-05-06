/**
 * URL Router
 * Dispatches URLs to the appropriate platform extractor.
 * Falls back to keyword search when no URL pattern matches.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import BilibiliValidator = require('../bilibili/validator');
import YouTubeValidator = require('../youtube/validator');
import * as logger from '../services/logger_service';

export type Platform = 'bilibili' | 'youtube' | 'unknown';

export interface RouteResult {
  platform: Platform;
  isUrl: boolean;
  /** Normalized URL (null if input is a keyword, not a URL) */
  normalizedUrl: string | null;
  /** Original input */
  raw: string;
}

/**
 * Determine which platform a URL belongs to, or mark it as a keyword search.
 */
export function routeQuery(query: string): RouteResult {
  if (!query || typeof query !== 'string') {
    return { platform: 'unknown', isUrl: false, normalizedUrl: null, raw: query };
  }

  const trimmed = query.trim();

  // Check Bilibili first (existing primary platform)
  if (BilibiliValidator.isValidBilibiliUrl(trimmed)) {
    return {
      platform: 'bilibili',
      isUrl: true,
      normalizedUrl: BilibiliValidator.normalizeUrl(trimmed),
      raw: trimmed,
    };
  }

  // Check YouTube
  if (YouTubeValidator.isValidYouTubeUrl(trimmed)) {
    return {
      platform: 'youtube',
      isUrl: true,
      normalizedUrl: YouTubeValidator.normalizeUrl(trimmed),
      raw: trimmed,
    };
  }

  // Looks like a URL but doesn't match any platform
  if (/^https?:\/\//i.test(trimmed)) {
    logger.warn('URL does not match any supported platform', { url: trimmed });
    return { platform: 'unknown', isUrl: true, normalizedUrl: null, raw: trimmed };
  }

  // Keyword search (not a URL)
  return { platform: 'unknown', isUrl: false, normalizedUrl: null, raw: trimmed };
}
