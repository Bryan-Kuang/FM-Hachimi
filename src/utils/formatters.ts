/**
 * Utility functions for formatting time, text, and other data
 */
class Formatters {
  static formatTime(seconds: number): string {
    if (!seconds || isNaN(seconds)) {
      return '0:00';
    }

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = Math.floor(seconds % 60);

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
    }

    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  }

  static parseTime(timeString: string): number {
    if (!timeString || typeof timeString !== 'string') {
      return 0;
    }

    const parts = timeString.split(':').map((part) => parseInt(part));

    if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    } else if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }

    return 0;
  }

  static generateProgressBar(current: number, total: number, length = 20): string {
    if (!current || !total || current < 0 || total <= 0) {
      return '▱'.repeat(length);
    }

    const progress = Math.min(Math.round((current / total) * length), length);
    const emptyProgress = length - progress;

    return `${'▰'.repeat(progress)}${'▱'.repeat(emptyProgress)}`;
  }

  static generateDetailedProgressBar(current: number, total: number, length = 15): {
    bar: string; percentage: number; currentTime: string;
    totalTime: string; remainingTime: string;
  } {
    if (!current || !total || current < 0 || total <= 0) {
      return {
        bar: '▱'.repeat(length),
        percentage: 0,
        currentTime: '0:00',
        totalTime: '0:00',
        remainingTime: '0:00',
      };
    }

    const progress = Math.min(Math.round((current / total) * length), length);
    const emptyProgress = length - progress;
    const bar = `${'▰'.repeat(progress)}${'▱'.repeat(emptyProgress)}`;

    return {
      bar,
      percentage: Math.min(Math.round((current / total) * 100), 100),
      currentTime: this.formatTime(current),
      totalTime: this.formatTime(total),
      remainingTime: this.formatTime(total - current),
    };
  }

  static generateCircularProgress(current: number, total: number): string {
    if (!current || !total || current < 0 || total <= 0) return '⚪';
    const p = (current / total) * 100;
    if (p < 12.5) return '🕐';
    if (p < 25) return '🕑';
    if (p < 37.5) return '🕒';
    if (p < 50) return '🕓';
    if (p < 62.5) return '🕔';
    if (p < 75) return '🕕';
    if (p < 87.5) return '🕖';
    return '🕗';
  }

  static truncateText(text: string, maxLength = 100): string {
    if (!text || typeof text !== 'string') return '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
  }

  static formatFileSize(bytes: number): string {
    if (!bytes || bytes === 0) return '0 B';
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
  }

  static formatDuration(seconds: number): string {
    if (!seconds || seconds < 0 || isNaN(seconds)) return 'Unknown duration';
    if (seconds < 60) return `${Math.round(seconds)} seconds`;
    if (seconds < 3600) {
      const minutes = Math.round(seconds / 60);
      return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
    }
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.round((seconds % 3600) / 60);
    if (minutes === 0) return `${hours} hour${hours !== 1 ? 's' : ''}`;
    return `${hours}h ${minutes}m`;
  }

  static formatNumber(num: number): string {
    if (!num || isNaN(num)) return '0';
    return num.toLocaleString();
  }

  static escapeMarkdown(text: string): string {
    if (!text || typeof text !== 'string') return '';
    return text.replace(/([*_`~|\\])/g, '\\$1');
  }
}

export = Formatters;
