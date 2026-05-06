/**
 * YouTube URL Validator
 * Validates and parses YouTube video URLs across all common formats.
 */

import * as logger from '../services/logger_service';

interface ParsedVideoId { type: 'STANDARD' | 'SHORT' | 'EMBED' | 'MUSIC'; id: string }

class YouTubeValidator {
  // Order matters: more-specific patterns (MUSIC, SHORTS, LIVE, EMBED) must
  // precede STANDARD to avoid the generic youtube.com/watch regex matching them.
  static YOUTUBE_PATTERNS: Record<string, RegExp> = {
    MUSIC: /(?:https?:\/\/)?music\.youtube\.com\/watch\?(?:.*&)?v=([a-zA-Z0-9_-]{11})/,
    SHORTS: /(?:https?:\/\/)?(?:www\.)?youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
    LIVE: /(?:https?:\/\/)?(?:www\.)?youtube\.com\/live\/([a-zA-Z0-9_-]{11})/,
    EMBED: /(?:https?:\/\/)?(?:www\.)?youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
    SHORT: /(?:https?:\/\/)?youtu\.be\/([a-zA-Z0-9_-]{11})/,
    STANDARD: /(?:https?:\/\/)?(?:www\.)?youtube\.com\/watch\?(?:.*&)?v=([a-zA-Z0-9_-]{11})/,
  };

  static isValidYouTubeUrl(url: string): boolean {
    if (!url || typeof url !== 'string') return false;
    return Object.values(this.YOUTUBE_PATTERNS).some((pattern) => pattern.test(url.trim()));
  }

  static extractVideoId(url: string): ParsedVideoId | null {
    if (!url || typeof url !== 'string') {
      logger.warn('Invalid URL provided to YouTube extractVideoId');
      return null;
    }

    const trimmedUrl = url.trim();

    for (const [type, pattern] of Object.entries(this.YOUTUBE_PATTERNS)) {
      const match = trimmedUrl.match(pattern);
      if (match) {
        return { type: type as ParsedVideoId['type'], id: match[1] };
      }
    }

    logger.warn(`No valid YouTube video ID found in URL: ${url}`);
    return null;
  }

  static normalizeUrl(url: string): string | null {
    const videoInfo = this.extractVideoId(url);
    if (!videoInfo) return null;
    return `https://www.youtube.com/watch?v=${videoInfo.id}`;
  }
}

export = YouTubeValidator;
