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
   * Generate Unicode progress bar
   * @param {number} current - Current position
   * @param {number} total - Total duration
   * @param {number} length - Progress bar length (default: 20)
   * @returns {string} - Unicode progress bar
   */
  static generateProgressBar(current, total, length = 20) {
    if (!current || !total || current < 0 || total <= 0) {
      const emptyBar = "░".repeat(length);
      return `${emptyBar} 0% | 0:00 / 0:00`;
    }

    const progress = Math.min(Math.round((current / total) * length), length);
    const emptyProgress = length - progress;

    const progressText = "█".repeat(progress);
    const emptyProgressText = "░".repeat(emptyProgress);

    const percentage = Math.min(Math.round((current / total) * 100), 100);
    const currentFormatted = this.formatTime(current);
    const totalFormatted = this.formatTime(total);

    return `${progressText}${emptyProgressText} ${percentage}% | ${currentFormatted} / ${totalFormatted}`;
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
