/**
 * Bilibili Audio Extractor
 * Handles video URL processing and audio stream extraction
 */

const _axios = require("axios");
const { spawn } = require("child_process");
const logger = require("../services/logger_service");
const UrlValidator = require("../utils/validator");

class BilibiliExtractor {
  constructor() {
    this.userAgent =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    this._ytdlpChecked = false; // Lazy check flag
    
    // Video info cache to avoid repeated yt-dlp calls
    this.videoInfoCache = new Map();
    this.cacheExpiry = 30 * 60 * 1000; // 30 minutes cache expiry
    this.maxCacheSize = 100; // Maximum number of cached entries
    
    // Start cache cleanup interval
    this.cacheCleanupInterval = setInterval(() => {
      this.cleanupExpiredCache();
    }, 10 * 60 * 1000); // Cleanup every 10 minutes
  }

  /**
   * Clean up expired cache entries and enforce size limit
   */
  cleanupExpiredCache() {
    const now = Date.now();
    let removedCount = 0;
    
    // Remove expired entries
    for (const [key, entry] of this.videoInfoCache) {
      if (now - entry.timestamp > this.cacheExpiry) {
        this.videoInfoCache.delete(key);
        removedCount++;
      }
    }
    
    // Enforce size limit by removing oldest entries
    if (this.videoInfoCache.size > this.maxCacheSize) {
      const entries = Array.from(this.videoInfoCache.entries());
      entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
      
      const toRemove = entries.slice(0, this.videoInfoCache.size - this.maxCacheSize);
      toRemove.forEach(([key]) => {
        this.videoInfoCache.delete(key);
        removedCount++;
      });
    }
    
    if (removedCount > 0) {
      logger.debug("Cache cleanup completed", { 
        removedEntries: removedCount, 
        remainingEntries: this.videoInfoCache.size 
      });
    }
  }

  /**
   * Clear all cache entries
   */
  clearCache() {
    this.videoInfoCache.clear();
    logger.info("Video info cache cleared");
  }

  /**
   * Cleanup resources when extractor is destroyed
   */
  destroy() {
    if (this.cacheCleanupInterval) {
      clearInterval(this.cacheCleanupInterval);
      this.cacheCleanupInterval = null;
    }
    this.clearCache();
  }

  /**
   * Extract audio stream URL and metadata from Bilibili video
   * @param {string} url - Bilibili video URL
   * @param {number} retryCount - Current retry attempt
   * @param {number} maxRetries - Maximum retry attempts
   * @returns {Promise<Object>} - Video metadata and audio stream info
   */
  async extractAudio(url, retryCount = 0, maxRetries = 2) {
    logger.info("Starting audio extraction", { url, attempt: retryCount + 1 });

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
        attempt: retryCount + 1,
        maxRetries: maxRetries,
      });
      
      // 如果是网络相关错误且还有重试次数，则重试
      if (retryCount < maxRetries && this.isRetryableError(error)) {
        logger.info("Retrying audio extraction", {
          url,
          nextAttempt: retryCount + 2,
          delay: (retryCount + 1) * 3000,
        });
        
        // 等待递增延迟后重试
        await new Promise(resolve => setTimeout(resolve, (retryCount + 1) * 3000));
        return await this.extractAudio(url, retryCount + 1, maxRetries);
      }
      
      throw new Error(`Audio extraction failed: ${error.message}`);
    }
  }

  /**
   * Get video metadata using yt-dlp
   * @param {string} url - Normalized Bilibili URL
   * @returns {Promise<Object>} - Video metadata
   */
  /**
   * Get video information with caching support
   * @param {string} url - Bilibili video URL
   * @returns {Promise<Object>} - Video metadata
   */
  async getVideoInfo(url) {
    // Create cache key from normalized URL
    const normalizedUrl = UrlValidator.normalizeUrl(url);
    const cacheKey = normalizedUrl || url;
    
    // Check cache first
    const cached = this.videoInfoCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
      logger.debug("Video info retrieved from cache", { url: cacheKey });
      return cached.data;
    }
    
    // If not in cache or expired, fetch from yt-dlp
    logger.debug("Fetching video info from yt-dlp", { url: cacheKey });
    
    return new Promise((resolve, reject) => {
      const args = [
        "--dump-json",
        "--no-download",
        "--no-check-certificate",
        "--no-warnings",
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
        if (code !== 0 && code !== null) {
          // 忽略进程被终止的情况
          if (code === 137 || code === 143) {
            logger.warn("yt-dlp process was terminated", {
              code,
              url,
            });
            reject(new Error("Video info extraction timeout"));
            return;
          }
          
          logger.error("yt-dlp failed to get video info", {
            code,
            stderr,
            url,
          });
          
          // 提供更具体的错误信息
          let errorMessage = `yt-dlp exited with code ${code}`;
          if (stderr.includes('Video unavailable')) {
            errorMessage = 'Video is unavailable or private';
          } else if (stderr.includes('network') || stderr.includes('timeout')) {
            errorMessage = 'Network connection error';
          } else if (stderr.includes('certificate') || stderr.includes('SSL')) {
            errorMessage = 'SSL certificate error';
          } else if (stderr) {
            errorMessage += `: ${stderr}`;
          }
          
          reject(new Error(errorMessage));
          return;
        }

        try {
          // yt-dlp --dump-json outputs one JSON object per line;
          // extra lines (warnings, progress) may appear — find the first valid JSON line
          const lines = stdout.split('\n').filter(l => l.trim());
          const jsonLine = lines.find(l => l.trim().startsWith('{'));
          if (!jsonLine) {
            throw new Error('No JSON object found in yt-dlp output');
          }
          const videoData = JSON.parse(jsonLine);
          const metadata = this.parseVideoMetadata(videoData);

          // Cache the result
          this.videoInfoCache.set(cacheKey, {
            data: metadata,
            timestamp: Date.now()
          });

          logger.debug("Video info cached", {
            url: cacheKey,
            cacheSize: this.videoInfoCache.size
          });

          resolve(metadata);
        } catch (parseError) {
          logger.error("Failed to parse video metadata", {
            error: parseError.message,
            stdout: stdout.substring(0, 500),
            stdoutTail: stdout.substring(Math.max(0, stdout.length - 200)),
            stdoutLength: stdout.length,
          });
          reject(
            new Error(`Failed to parse video metadata: ${parseError.message}`)
          );
        }
      });

      ytdlp.on("error", (error) => {
        logger.error("yt-dlp process error", { error: error.message });
        
        // 提供更具体的错误信息
        let errorMessage = 'yt-dlp process error';
        if (error.code === 'ENOENT') {
          errorMessage = 'yt-dlp is not installed or not found in PATH';
        } else if (error.message) {
          errorMessage += `: ${error.message}`;
        }
        
        reject(new Error(errorMessage));
      });

      // Set timeout for the operation
      const timeoutId = setTimeout(() => {
        ytdlp.kill('SIGTERM');
        // Force kill after 2 seconds if still running
        setTimeout(() => {
          if (!ytdlp.killed) {
            ytdlp.kill('SIGKILL');
          }
        }, 2000);
        reject(new Error("Video info extraction timeout"));
      }, 30000); // 30 seconds timeout
      
      // Clear timeout when process ends
      ytdlp.on('close', () => {
        clearTimeout(timeoutId);
      });
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
        "--no-warnings",
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
        if (code !== 0 && code !== null) {
          // 忽略进程被终止的情况
          if (code === 137 || code === 143) {
            logger.warn("yt-dlp process was terminated", {
              code,
              url,
            });
            reject(new Error("Audio stream URL extraction timeout"));
            return;
          }
          
          logger.error("yt-dlp failed to get audio stream URL", {
            code,
            stderr,
            url,
          });
          
          // 提供更具体的错误信息
          let errorMessage = `yt-dlp exited with code ${code}`;
          if (stderr.includes('Video unavailable')) {
            errorMessage = 'Video is unavailable or private';
          } else if (stderr.includes('network') || stderr.includes('timeout')) {
            errorMessage = 'Network connection error';
          } else if (stderr.includes('certificate') || stderr.includes('SSL')) {
            errorMessage = 'SSL certificate error';
          } else if (stderr.includes('No audio stream')) {
            errorMessage = 'No audio stream available for this video';
          } else if (stderr) {
            errorMessage += `: ${stderr}`;
          }
          
          reject(new Error(errorMessage));
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
        
        // 提供更具体的错误信息
        let errorMessage = 'yt-dlp process error';
        if (error.code === 'ENOENT') {
          errorMessage = 'yt-dlp is not installed or not found in PATH';
        } else if (error.message) {
          errorMessage += `: ${error.message}`;
        }
        
        reject(new Error(errorMessage));
      });

      // Set timeout for the operation
      const timeoutId = setTimeout(() => {
        ytdlp.kill('SIGTERM');
        // Force kill after 2 seconds if still running
        setTimeout(() => {
          if (!ytdlp.killed) {
            ytdlp.kill('SIGKILL');
          }
        }, 2000);
        reject(new Error("Audio stream URL extraction timeout"));
      }, 30000); // 30 seconds timeout
      
      // Clear timeout when process ends
      ytdlp.on('close', () => {
        clearTimeout(timeoutId);
      });
    });
  }

  /**
   * Parse and normalize video metadata from yt-dlp output
   * @param {Object} videoData - Raw video data from yt-dlp
   * @returns {Object} - Normalized metadata
   */
  parseVideoMetadata(videoData) {
    const metadata = {
      success: true,
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
      id: this.extractVideoId(
        videoData.webpage_url || videoData.original_url
      ),
      url: videoData.webpage_url || videoData.original_url,
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
   * Check if an error is retryable (network-related)
   * @param {Error} error - The error to check
   * @returns {boolean} - True if the error is retryable
   */
  isRetryableError(error) {
    const message = error.message.toLowerCase();
    
    // Network-related errors that can be retried
    const retryableErrors = [
      'timeout',
      'network',
      'connection',
      'econnreset',
      'enotfound',
      'econnrefused',
      'etimedout',
      'socket hang up',
      'certificate',
      'ssl',
      'tls',
      'temporary failure',
      'service unavailable',
      '502',
      '503',
      '504'
    ];
    
    return retryableErrors.some(errorType => message.includes(errorType));
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

  /**
   * Search for Bilibili videos by keyword
   * @param {string} keyword - Search keyword
   * @param {number} maxResults - Maximum number of results (default: 10)
   * @returns {Promise<Object>} - Search results with video info
   */
  async searchVideos(keyword, maxResults = 10) {
    logger.info("Starting Bilibili video search", { keyword, maxResults });

    try {
      // Check yt-dlp availability
      if (!this._ytdlpChecked) {
        const ytdlpAvailable = await this.checkYtDlpAvailability();
        if (!ytdlpAvailable) {
          throw new Error(
            "yt-dlp is not available. Please install it: pip install yt-dlp"
          );
        }
        this._ytdlpChecked = true;
      }

      // Step 1: Get video IDs using bilisearch
      const searchQuery = `bilisearch${maxResults}:${keyword}`;
      const videoIds = await this.getSearchVideoIds(searchQuery);
      
      if (!videoIds || videoIds.length === 0) {
        return {
          success: true,
          results: [],
          keyword,
          timestamp: new Date().toISOString()
        };
      }

      // Step 2: Get detailed info for each video
      const results = await this.getVideoDetailsForSearch(videoIds);
      
      logger.info("Search completed successfully", { 
        keyword, 
        resultCount: results.length 
      });
      
      return {
        success: true,
        results,
        keyword,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error("Search error", { error: error.message, keyword });
      return {
        success: false,
        error: error.message,
        keyword,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Get video IDs from bilisearch
   * @param {string} searchQuery - Search query for bilisearch
   * @returns {Promise<Array>} - Array of video IDs
   */
  async getSearchVideoIds(searchQuery) {
    return new Promise((resolve, reject) => {
      const ytdlpProcess = spawn("yt-dlp", [
        searchQuery,
        "--get-id",
        "--no-download",
        "--flat-playlist"
      ]);

      let stdout = "";
      let stderr = "";

      ytdlpProcess.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      ytdlpProcess.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      ytdlpProcess.on("close", (code) => {
        if (code !== 0) {
          logger.error("yt-dlp search failed", { code, stderr, searchQuery });
          reject(new Error(`Search failed: ${stderr}`));
          return;
        }

        const videoIds = stdout.trim().split('\n').filter(id => id.trim());
        resolve(videoIds);
      });

      ytdlpProcess.on("error", (error) => {
        logger.error("yt-dlp process error during search", { 
          error: error.message,
          searchQuery 
        });
        reject(error);
      });
    });
  }

  /**
   * Get detailed video information for search results
   * @param {Array} videoIds - Array of video IDs
   * @returns {Promise<Array>} - Array of video details
   */
  /**
   * Get detailed video information for search results with optimized batch processing
   * @param {Array} videoIds - Array of video IDs
   * @returns {Promise<Array>} - Array of video details
   */
  async getVideoDetailsForSearch(videoIds) {
    const _results = [];
    
    // Dynamic concurrent limit based on number of videos
    const maxConcurrent = Math.min(5, Math.max(2, Math.ceil(videoIds.length / 3)));
    
    logger.debug("Starting batch video details extraction", {
      totalVideos: videoIds.length,
      concurrentLimit: maxConcurrent
    });
    
    // Process all videos concurrently with Promise.allSettled for better performance
    const allPromises = videoIds.map(async (videoId, index) => {
      try {
        // Add staggered delay to avoid overwhelming the server
        const delay = Math.floor(index / maxConcurrent) * 100; // 100ms delay per batch
        if (delay > 0) {
          await new Promise(resolve => setTimeout(resolve, delay));
        }
        
        // Convert numeric ID to BV format URL
        const videoUrl = `https://www.bilibili.com/video/av${videoId}`;
        
        // Reduced timeout for faster processing
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => {
            reject(new Error(`Video info timeout for ${videoId}`));
          }, 8000); // Reduced to 8 seconds per video
        });
        
        const videoInfo = await Promise.race([
          this.getVideoInfo(videoUrl),
          timeoutPromise
        ]);
        
        if (videoInfo.success) {
          return {
            title: videoInfo.title,
            id: videoInfo.id,
            url: videoInfo.url,
            duration: videoInfo.duration || 'Unknown',
            uploader: videoInfo.uploader || 'Unknown',
            viewCount: videoInfo.viewCount || '0',
            thumbnail: videoInfo.thumbnail || null,
            index // Keep original order for sorting
          };
        }
      } catch (error) {
        logger.warn("Failed to get video details", { 
          videoId, 
          error: error.message 
        });
        // Continue with other videos even if one fails
      }
      return null;
    });
    
    // Wait for all requests to complete
    const allResults = await Promise.allSettled(allPromises);
    
    // Filter successful results and maintain original order
    const successfulResults = allResults
      .filter(result => result.status === 'fulfilled' && result.value)
      .map(result => result.value)
      .sort((a, b) => a.index - b.index) // Maintain original order
      .map(({ index: _index, ...rest }) => rest); // Remove index field (underscore to satisfy lint)
    
    logger.debug("Batch video details extraction completed", {
      totalRequested: videoIds.length,
      successfulResults: successfulResults.length,
      failedResults: videoIds.length - successfulResults.length
    });
    
    return successfulResults;
  }

  /**
   * Parse search results from yt-dlp output
   * @param {string} output - Raw yt-dlp output
   * @returns {Array} - Parsed search results
   */
  parseSearchResults(output) {
    const lines = output.trim().split('\n').filter(line => line.trim());
    const results = [];

    for (const line of lines) {
      const parts = line.split('|||');
      if (parts.length >= 6) {
        const [title, id, duration, uploader, viewCount, thumbnail] = parts;
        
        results.push({
          title: title.trim(),
          id: id.trim(),
          url: `https://www.bilibili.com/video/${id.trim()}`,
          duration: duration.trim() || 'Unknown',
          uploader: uploader.trim() || 'Unknown',
          viewCount: viewCount.trim() || '0',
          thumbnail: thumbnail.trim() || null
        });
      }
    }

    return results;
  }
}

module.exports = BilibiliExtractor;
