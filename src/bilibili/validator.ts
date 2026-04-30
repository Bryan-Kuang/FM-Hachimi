import * as logger from '../services/logger_service';

interface ParsedVideoId { type: 'BV' | 'AV' | 'SHORT'; id: string }
interface CommandValidationResult { valid: boolean; errors: string[] }

/**
 * Validates and parses Bilibili video URLs
 */
class UrlValidator {
  static BILIBILI_PATTERNS: Record<string, RegExp> = {
    BV: /(?:https?:\/\/)?(?:www\.)?bilibili\.com\/video\/(BV[a-zA-Z0-9]+)/,
    AV: /(?:https?:\/\/)?(?:www\.)?bilibili\.com\/video\/av(\d+)/,
    SHORT: /(?:https?:\/\/)?b23\.tv\/([a-zA-Z0-9]+)/,
    MOBILE: /(?:https?:\/\/)?m\.bilibili\.com\/video\/(BV[a-zA-Z0-9]+|av\d+)/,
  };

  static isValidBilibiliUrl(url: string): boolean {
    if (!url || typeof url !== 'string') return false;
    return Object.values(this.BILIBILI_PATTERNS).some((pattern) => pattern.test(url.trim()));
  }

  static extractVideoId(url: string): ParsedVideoId | null {
    if (!url || typeof url !== 'string') {
      logger.warn('Invalid URL provided to extractVideoId');
      return null;
    }

    const trimmedUrl = url.trim();

    const bvMatch = trimmedUrl.match(this.BILIBILI_PATTERNS.BV);
    if (bvMatch) return { type: 'BV', id: bvMatch[1] };

    const avMatch = trimmedUrl.match(this.BILIBILI_PATTERNS.AV);
    if (avMatch) return { type: 'AV', id: avMatch[1] };

    const mobileMatch = trimmedUrl.match(this.BILIBILI_PATTERNS.MOBILE);
    if (mobileMatch) {
      const id = mobileMatch[1];
      return {
        type: id.startsWith('BV') ? 'BV' : 'AV',
        id: id.startsWith('av') ? id.substring(2) : id,
      };
    }

    const shortMatch = trimmedUrl.match(this.BILIBILI_PATTERNS.SHORT);
    if (shortMatch) return { type: 'SHORT', id: shortMatch[1] };

    logger.warn(`No valid Bilibili video ID found in URL: ${url}`);
    return null;
  }

  static normalizeUrl(url: string): string | null {
    const videoInfo = this.extractVideoId(url);
    if (!videoInfo) return null;

    if (videoInfo.type === 'SHORT') return url;

    const baseUrl = 'https://www.bilibili.com/video/';
    if (videoInfo.type === 'BV') return `${baseUrl}${videoInfo.id}`;
    if (videoInfo.type === 'AV') return `${baseUrl}av${videoInfo.id}`;

    return url;
  }

  static validateCommandOptions(options: { url?: string }): CommandValidationResult {
    const errors: string[] = [];

    if (!options.url) {
      errors.push('URL parameter is required');
    } else if (!this.isValidBilibiliUrl(options.url)) {
      errors.push('Invalid Bilibili URL format');
    }

    return { valid: errors.length === 0, errors };
  }
}

export = UrlValidator;
