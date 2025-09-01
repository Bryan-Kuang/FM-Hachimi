/**
 * Bilibili Audio Extractor
 * Handles video URL processing and audio stream extraction
 */

const axios = require("axios");
const { spawn } = require("child_process");
const logger = require("../utils/logger");
const UrlValidator = require("../utils/validator");

class BilibiliExtractor {
  constructor() {
    this.userAgent =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    this._ytdlpChecked = false; // Lazy check flag
  }

  /**
   * Extract audio stream URL and metadata from Bilibili video
   * @param {string} url - Bilibili video URL
   * @returns {Promise<Object>} - Video metadata and audio stream info
   */
  async extractAudio(url) {
    logger.info("Starting audio extraction", { url });

    try {
      // Check yt-dlp availability on first use (lazy check)
      if (!this._ytdlpChecked) {
        const ytdlpAvailable = await this.checkYtDlpAvailability();
        if (!ytdlpAvailable) {
          throw new Error(
            "yt-dlp is not available. Please install it: pip install yt-dlp"
          );
        }
        this._ytdlpChecked = true;
        logger.info("yt-dlp availability confirmed");
      }

      // Validate URL first
      if (!UrlValidator.isValidBilibiliUrl(url)) {
        throw new Error("Invalid Bilibili URL format");
      }

      // Normalize URL
      const normalizedUrl = UrlValidator.normalizeUrl(url);
      if (!normalizedUrl) {
        throw new Error("Failed to normalize URL");
      }

      // Extract video information
      const videoInfo = await this.getVideoInfo(normalizedUrl);

      // Get audio stream URL
      const audioStreamUrl = await this.getAudioStreamUrl(normalizedUrl);

      const result = {
        ...videoInfo,
        audioUrl: audioStreamUrl,
        originalUrl: url,
        normalizedUrl: normalizedUrl,
        extractedAt: new Date().toISOString(),
      };

      logger.info("Audio extraction completed successfully", {
        url,
        title: result.title,
        duration: result.duration,
      });

      return result;
    } catch (error) {
      logger.error("Audio extraction failed", {
        url,
        error: error.message,
        stack: error.stack,
      });
      throw new Error(`Audio extraction failed: ${error.message}`);
    }
  }

  /**
   * Get video metadata using yt-dlp
   * @param {string} url - Normalized Bilibili URL
   * @returns {Promise<Object>} - Video metadata
   */
  async getVideoInfo(url) {
    return new Promise((resolve, reject) => {
      const args = [
        "--dump-json",
        "--no-download",
        "--no-check-certificate",
        "--user-agent",
        this.userAgent,
        url,
      ];

      logger.debug("Executing yt-dlp for video info", { args });

      const ytdlp = spawn("yt-dlp", args);
      let stdout = "";
      let stderr = "";

      ytdlp.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      ytdlp.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      ytdlp.on("close", (code) => {
        if (code !== 0) {
          logger.error("yt-dlp failed to get video info", {
            code,
            stderr,
            url,
          });
          reject(new Error(`yt-dlp exited with code ${code}: ${stderr}`));
          return;
        }

        try {
          const videoData = JSON.parse(stdout);
          const metadata = this.parseVideoMetadata(videoData);
          resolve(metadata);
        } catch (parseError) {
          logger.error("Failed to parse video metadata", {
            error: parseError.message,
            stdout: stdout.substring(0, 500),
          });
          reject(
            new Error(`Failed to parse video metadata: ${parseError.message}`)
          );
        }
      });

      ytdlp.on("error", (error) => {
        logger.error("yt-dlp process error", { error: error.message });
        reject(new Error(`yt-dlp process error: ${error.message}`));
      });

      // Set timeout for the operation
      setTimeout(() => {
        ytdlp.kill();
        reject(new Error("Video info extraction timeout"));
      }, 30000); // 30 seconds timeout
    });
  }

  /**
   * Get audio stream URL using yt-dlp
   * @param {string} url - Normalized Bilibili URL
   * @returns {Promise<string>} - Audio stream URL
   */
  async getAudioStreamUrl(url) {
    return new Promise((resolve, reject) => {
      const args = [
        "--get-url",
        "--format",
        "bestaudio/best",
        "--no-check-certificate",
        "--user-agent",
        this.userAgent,
        url,
      ];

      logger.debug("Executing yt-dlp for audio stream URL", { args });

      const ytdlp = spawn("yt-dlp", args);
      let stdout = "";
      let stderr = "";

      ytdlp.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      ytdlp.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      ytdlp.on("close", (code) => {
        if (code !== 0) {
          logger.error("yt-dlp failed to get audio stream URL", {
            code,
            stderr,
            url,
          });
          reject(new Error(`yt-dlp exited with code ${code}: ${stderr}`));
          return;
        }

        const audioUrl = stdout.trim();
        if (!audioUrl) {
          reject(new Error("No audio stream URL found"));
          return;
        }

        resolve(audioUrl);
      });

      ytdlp.on("error", (error) => {
        logger.error("yt-dlp process error for audio stream", {
          error: error.message,
        });
        reject(new Error(`yt-dlp process error: ${error.message}`));
      });

      // Set timeout for the operation
      setTimeout(() => {
        ytdlp.kill();
        reject(new Error("Audio stream URL extraction timeout"));
      }, 30000); // 30 seconds timeout
    });
  }

  /**
   * Parse and normalize video metadata from yt-dlp output
   * @param {Object} videoData - Raw video data from yt-dlp
   * @returns {Object} - Normalized metadata
   */
  parseVideoMetadata(videoData) {
    const metadata = {
      title: videoData.title || "Unknown Title",
      description: videoData.description || "",
      duration: videoData.duration || 0,
      uploader: videoData.uploader || videoData.channel || "Unknown",
      uploadDate: videoData.upload_date || null,
      viewCount: videoData.view_count || 0,
      likeCount: videoData.like_count || 0,
      thumbnail: this.selectBestThumbnail(videoData.thumbnails),
      videoId: this.extractVideoId(
        videoData.webpage_url || videoData.original_url
      ),
      webpage_url: videoData.webpage_url,
    };

    // Parse upload date if available
    if (metadata.uploadDate) {
      try {
        const year = metadata.uploadDate.substring(0, 4);
        const month = metadata.uploadDate.substring(4, 6);
        const day = metadata.uploadDate.substring(6, 8);
        metadata.uploadDateFormatted = `${year}-${month}-${day}`;
      } catch (error) {
        logger.warn("Failed to parse upload date", {
          uploadDate: metadata.uploadDate,
        });
      }
    }

    logger.debug("Parsed video metadata", {
      title: metadata.title,
      duration: metadata.duration,
      uploader: metadata.uploader,
    });

    return metadata;
  }

  /**
   * Select the best thumbnail from available options
   * @param {Array} thumbnails - Array of thumbnail objects
   * @returns {string} - Best thumbnail URL
   */
  selectBestThumbnail(thumbnails) {
    if (!thumbnails || !Array.isArray(thumbnails) || thumbnails.length === 0) {
      return null;
    }

    // Sort by resolution (width * height) and pick the highest
    const sorted = thumbnails
      .filter((thumb) => thumb.url && thumb.width && thumb.height)
      .sort((a, b) => b.width * b.height - a.width * a.height);

    return sorted.length > 0 ? sorted[0].url : thumbnails[0].url;
  }

  /**
   * Extract video ID from URL
   * @param {string} url - Video URL
   * @returns {string} - Video ID
   */
  extractVideoId(url) {
    if (!url) return null;

    const videoInfo = UrlValidator.extractVideoId(url);
    return videoInfo ? videoInfo.id : null;
  }

  /**
   * Check if yt-dlp is available on the system
   * @returns {Promise<boolean>} - True if yt-dlp is available
   */
  async checkYtDlpAvailability() {
    return new Promise((resolve) => {
      const ytdlp = spawn("yt-dlp", ["--version"]);

      ytdlp.on("close", (code) => {
        resolve(code === 0);
      });

      ytdlp.on("error", () => {
        resolve(false);
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        ytdlp.kill();
        resolve(false);
      }, 5000);
    });
  }

  /**
   * Test extraction with a sample URL (for development/testing)
   * @param {string} testUrl - Test URL (optional)
   * @returns {Promise<Object>} - Test results
   */
  async testExtraction(
    testUrl = "https://www.bilibili.com/video/BV1uv4y1q7Mv"
  ) {
    logger.info("Starting extraction test", { testUrl });

    try {
      // Check yt-dlp availability
      const ytdlpAvailable = await this.checkYtDlpAvailability();
      if (!ytdlpAvailable) {
        throw new Error("yt-dlp is not available on this system");
      }

      // Perform extraction
      const result = await this.extractAudio(testUrl);

      return {
        success: true,
        result,
        ytdlpAvailable,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      logger.error("Extraction test failed", {
        testUrl,
        error: error.message,
      });

      return {
        success: false,
        error: error.message,
        ytdlpAvailable: await this.checkYtDlpAvailability(),
        timestamp: new Date().toISOString(),
      };
    }
  }
}

module.exports = BilibiliExtractor;
