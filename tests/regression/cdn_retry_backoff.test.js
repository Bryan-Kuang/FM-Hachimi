/**
 * Regression: CDN retry uses exponential backoff BEFORE refreshing the URL.
 *
 * Observed bug in production (2026-04-20 VPS logs): the same signed Bilibili
 * CDN URL returned HTTP 403 five times in 31 seconds. Root cause is
 * Bilibili's risk-control layer locking the signed URL once it trips; yt-dlp
 * re-queried within that lock window got the same locked URL back, so a
 * fixed 2s delay between retries was simply not enough cooldown.
 *
 * Fix: 3s → 15s exponential backoff (capped at 30s) BEFORE we call the
 * extractor. These tests lock down the math + the "skip during backoff"
 * abort guard that the new window makes meaningful.
 */

jest.mock("child_process", () => ({ spawn: jest.fn(), execFile: jest.fn() }));
jest.mock("../../src/services/logger_service", () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const AudioPlayer = require("../../src/audio/audio_player");
const config = require("../../src/config/config");

describe("regression: CDN retry exponential backoff", () => {
  let player;

  beforeEach(() => {
    player = new AudioPlayer();
    player.handleTrackEnd = jest.fn();
    player.playCurrentTrack = jest.fn().mockResolvedValue(true);
  });

  afterEach(() => jest.clearAllTimers());

  describe("_computeCdnBackoffMs — formula", () => {
    test("returns 0 under NODE_ENV=test (Jest default)", () => {
      expect(process.env.NODE_ENV).toBe("test");
      expect(player._computeCdnBackoffMs(1)).toBe(0);
      expect(player._computeCdnBackoffMs(10)).toBe(0);
    });

    test("in production, attempt 1 returns base (3s default)", () => {
      const prev = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";
      try {
        expect(player._computeCdnBackoffMs(1)).toBe(config.retry.cdnBackoffBaseMs);
      } finally {
        process.env.NODE_ENV = prev;
      }
    });

    test("in production, attempt 2 returns base*multiplier (15s default)", () => {
      const prev = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";
      try {
        expect(player._computeCdnBackoffMs(2)).toBe(
          config.retry.cdnBackoffBaseMs * config.retry.cdnBackoffMultiplier,
        );
      } finally {
        process.env.NODE_ENV = prev;
      }
    });

    test("caps at cdnBackoffMaxMs on far-out attempts", () => {
      const prev = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";
      try {
        // attempt=5 → 3000 * 5^4 = 1,875,000ms uncapped
        expect(player._computeCdnBackoffMs(5)).toBe(config.retry.cdnBackoffMaxMs);
      } finally {
        process.env.NODE_ENV = prev;
      }
    });

    test("attempt=0 degrades gracefully (not negative exponent)", () => {
      const prev = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";
      try {
        // Math.max(0, -1) = 0 → base * 1 = base
        expect(player._computeCdnBackoffMs(0)).toBe(config.retry.cdnBackoffBaseMs);
      } finally {
        process.env.NODE_ENV = prev;
      }
    });
  });

  describe("retryCurrentTrack — skip-during-backoff guard", () => {
    // NODE_ENV=test makes backoff 0ms, so these run synchronously fast.

    test("aborts retry when currentTrack changes during backoff window", async () => {
      const originalTrack = {
        title: "original",
        normalizedUrl: "https://bilibili.com/video/BV1",
        retryCount: 0,
        incrementRetry() { this.retryCount++; },
      };
      player.currentTrack = originalTrack;
      player.extractor = {
        getAudioStreamUrl: jest.fn().mockResolvedValue("https://cdn/fresh"),
      };

      // Force a non-zero backoff so the _sleep branch actually executes,
      // then hook _sleep to simulate a user skip landing mid-window.
      player._computeCdnBackoffMs = jest.fn().mockReturnValue(100);
      const newTrack = { title: "new", normalizedUrl: "https://bilibili.com/video/BV2" };
      player._sleep = jest.fn().mockImplementation(async () => {
        player.currentTrack = newTrack;
      });

      await player.retryCurrentTrack();

      expect(player._sleep).toHaveBeenCalledWith(100);
      expect(player.extractor.getAudioStreamUrl).not.toHaveBeenCalled();
      expect(player.playCurrentTrack).not.toHaveBeenCalled();
      expect(player.handleTrackEnd).not.toHaveBeenCalled();
      // The ORIGINAL track's retry count was bumped — that's fine; it
      // prevents the same failing track from retrying forever if the user
      // skips back to it via /previous.
      expect(originalTrack.retryCount).toBe(1);
    });

    test("aborts if currentTrack changes during URL refresh", async () => {
      const originalTrack = {
        title: "original",
        normalizedUrl: "https://bilibili.com/video/BV1",
        retryCount: 0,
        incrementRetry() { this.retryCount++; },
      };
      const newTrack = { title: "new", normalizedUrl: "https://bilibili.com/video/BV2" };
      player.currentTrack = originalTrack;
      player.extractor = {
        getAudioStreamUrl: jest.fn().mockImplementation(async () => {
          // Flip the current track mid-extraction
          player.currentTrack = newTrack;
          return "https://cdn/fresh";
        }),
      };

      await player.retryCurrentTrack();

      expect(player.extractor.getAudioStreamUrl).toHaveBeenCalledTimes(1);
      expect(player.playCurrentTrack).not.toHaveBeenCalled();
      // Fresh URL was NOT applied to the original track (it's stale now)
      expect(originalTrack.audioUrl).toBeUndefined();
    });

    test("happy path: backoff → refresh → play on the same track", async () => {
      const track = {
        title: "t",
        normalizedUrl: "https://bilibili.com/video/BV1",
        retryCount: 0,
        incrementRetry() { this.retryCount++; },
      };
      player.currentTrack = track;
      player.extractor = {
        getAudioStreamUrl: jest.fn().mockResolvedValue("https://cdn/fresh"),
      };

      await player.retryCurrentTrack();

      expect(player.extractor.getAudioStreamUrl).toHaveBeenCalledWith(track.normalizedUrl);
      expect(track.audioUrl).toBe("https://cdn/fresh");
      expect(player.playCurrentTrack).toHaveBeenCalledTimes(1);
      expect(player.handleTrackEnd).not.toHaveBeenCalled();
    });

    test("stops retrying after retryCount > 2 (respects existing max-attempt policy)", async () => {
      const track = {
        title: "t",
        normalizedUrl: "https://bilibili.com/video/BV1",
        retryCount: 2, // next incrementRetry → 3, which exceeds the limit
        incrementRetry() { this.retryCount++; },
      };
      player.currentTrack = track;

      await player.retryCurrentTrack();

      expect(player.handleTrackEnd).toHaveBeenCalledTimes(1);
      expect(player.playCurrentTrack).not.toHaveBeenCalled();
    });
  });
});
