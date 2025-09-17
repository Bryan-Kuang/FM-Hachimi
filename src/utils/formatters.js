/**
 * Utility functions for formatting time, text, and other data
 */
class Formatters {
  /**
   * Format seconds to MM:SS or HH:MM:SS format
   * @param {number} seconds - Time in seconds
   * @returns {string} - Formatted time string
   */
  static formatTime(seconds) {
    if (!seconds || isNaN(seconds)) {
      return "0:00";
    }

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = Math.floor(seconds % 60);

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, "0")}:${remainingSeconds
        .toString()
        .padStart(2, "0")}`;
    }

    return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
  }

  /**
   * Parse time string to seconds
   * @param {string} timeString - Time in MM:SS or HH:MM:SS format
   * @returns {number} - Time in seconds
   */
  static parseTime(timeString) {
    if (!timeString || typeof timeString !== "string") {
      return 0;
    }

    const parts = timeString.split(":").map((part) => parseInt(part));

    if (parts.length === 2) {
      // MM:SS format
      return parts[0] * 60 + parts[1];
    } else if (parts.length === 3) {
      // HH:MM:SS format
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }

    return 0;
  }

  /**
   * Generate modern Unicode progress bar with enhanced visual design
   * @param {number} current - Current position
   * @param {number} total - Total duration
   * @param {number} length - Progress bar length (default: 20)
   * @returns {string} - Modern Unicode progress bar
   */
  static generateProgressBar(current, total, length = 20) {
    if (!current || !total || current < 0 || total <= 0) {
      const emptyBar = "▱".repeat(length);
      return `${emptyBar}`;
    }

    const progress = Math.min(Math.round((current / total) * length), length);
    const emptyProgress = length - progress;

    // Use modern progress bar characters for better visual appeal
    const progressText = "▰".repeat(progress);
    const emptyProgressText = "▱".repeat(emptyProgress);

    return `${progressText}${emptyProgressText}`;
  }

  /**
   * Generate detailed progress bar with percentage and time info
   * @param {number} current - Current position
   * @param {number} total - Total duration
   * @param {number} length - Progress bar length (default: 15)
   * @returns {Object} - Progress bar components
   */
  static generateDetailedProgressBar(current, total, length = 15) {
    if (!current || !total || current < 0 || total <= 0) {
      return {
        bar: "▱".repeat(length),
        percentage: 0,
        currentTime: "0:00",
        totalTime: "0:00",
        remainingTime: "0:00"
      };
    }

    const progress = Math.min(Math.round((current / total) * length), length);
    const emptyProgress = length - progress;

    const progressText = "▰".repeat(progress);
    const emptyProgressText = "▱".repeat(emptyProgress);
    const bar = `${progressText}${emptyProgressText}`;

    const percentage = Math.min(Math.round((current / total) * 100), 100);
    const currentTime = this.formatTime(current);
    const totalTime = this.formatTime(total);
    const remainingTime = this.formatTime(total - current);

    return {
      bar,
      percentage,
      currentTime,
      totalTime,
      remainingTime
    };
  }

  /**
   * Generate circular progress indicator for compact displays
   * @param {number} current - Current position
   * @param {number} total - Total duration
   * @returns {string} - Circular progress indicator
   */
  static generateCircularProgress(current, total) {
    if (!current || !total || current < 0 || total <= 0) {
      return "⚪";
    }

    const percentage = (current / total) * 100;
    
    if (percentage < 12.5) return "🕐";
    if (percentage < 25) return "🕑";
    if (percentage < 37.5) return "🕒";
    if (percentage < 50) return "🕓";
    if (percentage < 62.5) return "🕔";
    if (percentage < 75) return "🕕";
    if (percentage < 87.5) return "🕖";
    return "🕗";
  }

  /**
   * Truncate text to specified length with ellipsis
   * @param {string} text - Text to truncate
   * @param {number} maxLength - Maximum length (default: 100)
   * @returns {string} - Truncated text
   */
  static truncateText(text, maxLength = 100) {
    if (!text || typeof text !== "string") {
      return "";
    }

    if (text.length <= maxLength) {
      return text;
    }

    return text.substring(0, maxLength - 3) + "...";
  }

  /**
   * Format file size in human readable format
   * @param {number} bytes - Size in bytes
   * @returns {string} - Formatted size string
   */
  static formatFileSize(bytes) {
    if (!bytes || bytes === 0) {
      return "0 B";
    }

    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));

    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
  }

  /**
   * Format duration in human readable format
   * @param {number} seconds - Duration in seconds
   * @returns {string} - Human readable duration
   */
  static formatDuration(seconds) {
    if (!seconds || seconds < 0) {
      return "Unknown duration";
    }

    if (seconds < 60) {
      return `${Math.round(seconds)} seconds`;
    } else if (seconds < 3600) {
      const minutes = Math.round(seconds / 60);
      return `${minutes} minute${minutes !== 1 ? "s" : ""}`;
    } else {
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.round((seconds % 3600) / 60);

      if (minutes === 0) {
        return `${hours} hour${hours !== 1 ? "s" : ""}`;
      }

      return `${hours}h ${minutes}m`;
    }
  }

  /**
   * Format number with thousands separators
   * @param {number} num - Number to format
   * @returns {string} - Formatted number string
   */
  static formatNumber(num) {
    if (!num || isNaN(num)) {
      return "0";
    }

    return num.toLocaleString();
  }

  /**
   * Escape Discord markdown characters
   * @param {string} text - Text to escape
   * @returns {string} - Escaped text
   */
  static escapeMarkdown(text) {
    if (!text || typeof text !== "string") {
      return "";
    }

    return text.replace(/([*_`~|\\])/g, "\\$1");
  }
}

module.exports = Formatters;
