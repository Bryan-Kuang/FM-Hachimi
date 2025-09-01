const logger = require("./logger");

/**
 * Validates and parses Bilibili video URLs
 */
class UrlValidator {
  static BILIBILI_PATTERNS = {
    BV: /(?:https?:\/\/)?(?:www\.)?bilibili\.com\/video\/(BV[a-zA-Z0-9]+)/,
    AV: /(?:https?:\/\/)?(?:www\.)?bilibili\.com\/video\/av(\d+)/,
    SHORT: /(?:https?:\/\/)?b23\.tv\/([a-zA-Z0-9]+)/,
    MOBILE: /(?:https?:\/\/)?m\.bilibili\.com\/video\/(BV[a-zA-Z0-9]+|av\d+)/,
  };

  /**
   * Validates if URL is a supported Bilibili video URL
   * @param {string} url - URL to validate
   * @returns {boolean} - True if valid Bilibili URL
   */
  static isValidBilibiliUrl(url) {
    if (!url || typeof url !== "string") {
      return false;
    }

    return Object.values(this.BILIBILI_PATTERNS).some((pattern) =>
      pattern.test(url.trim())
    );
  }

  /**
   * Extracts video ID from Bilibili URL
   * @param {string} url - Bilibili video URL
   * @returns {object|null} - {type, id} or null if invalid
   */
  static extractVideoId(url) {
    if (!url || typeof url !== "string") {
      logger.warn("Invalid URL provided to extractVideoId");
      return null;
    }

    const trimmedUrl = url.trim();

    // Check BV format
    const bvMatch = trimmedUrl.match(this.BILIBILI_PATTERNS.BV);
    if (bvMatch) {
      return { type: "BV", id: bvMatch[1] };
    }

    // Check AV format
    const avMatch = trimmedUrl.match(this.BILIBILI_PATTERNS.AV);
    if (avMatch) {
      return { type: "AV", id: avMatch[1] };
    }

    // Check mobile format
    const mobileMatch = trimmedUrl.match(this.BILIBILI_PATTERNS.MOBILE);
    if (mobileMatch) {
      const id = mobileMatch[1];
      return {
        type: id.startsWith("BV") ? "BV" : "AV",
        id: id.startsWith("av") ? id.substring(2) : id,
      };
    }

    // Check short URL format (needs expansion)
    const shortMatch = trimmedUrl.match(this.BILIBILI_PATTERNS.SHORT);
    if (shortMatch) {
      return { type: "SHORT", id: shortMatch[1] };
    }

    logger.warn(`No valid Bilibili video ID found in URL: ${url}`);
    return null;
  }

  /**
   * Normalizes Bilibili URL to standard format
   * @param {string} url - Input URL
   * @returns {string|null} - Normalized URL or null if invalid
   */
  static normalizeUrl(url) {
    const videoInfo = this.extractVideoId(url);
    if (!videoInfo) {
      return null;
    }

    if (videoInfo.type === "SHORT") {
      // For short URLs, we would need to expand them
      // For now, return as-is and handle expansion in extractor
      return url;
    }

    const baseUrl = "https://www.bilibili.com/video/";
    if (videoInfo.type === "BV") {
      return `${baseUrl}${videoInfo.id}`;
    } else if (videoInfo.type === "AV") {
      return `${baseUrl}av${videoInfo.id}`;
    }

    return url;
  }

  /**
   * Validates Discord slash command parameters
   * @param {object} options - Command options
   * @returns {object} - {valid: boolean, errors: string[]}
   */
  static validateCommandOptions(options) {
    const errors = [];

    if (!options.url) {
      errors.push("URL parameter is required");
    } else if (!this.isValidBilibiliUrl(options.url)) {
      errors.push("Invalid Bilibili URL format");
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}

module.exports = UrlValidator;
