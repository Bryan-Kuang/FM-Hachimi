/**
 * Regression: AudioManager.getPlayer() must forward its extractor to the
 * newly-constructed AudioPlayer.
 *
 * Production regression 2026-04-22: AudioPlayer.retryCurrentTrack() contains
 *
 *   if (trackAtStart.normalizedUrl) {
 *     try {
 *       if (this.extractor) {                   // ← silently false
 *         const freshUrl = await this.extractor.getAudioStreamUrl(...);
 *         trackAtStart.audioUrl = freshUrl;
 *         logger.info("Refreshed audio URL for retry", ...);
 *       }
 *     } catch (e) { logger.warn("Failed to refresh audio URL...", ...); }
 *   }
 *
 * AudioManager.getPlayer was calling `new AudioPlayer()` with no arguments,
 * so AudioPlayer's constructor set `this.extractor = null`. Every CDN 403
 * retry path then hit the `if (this.extractor)` guard and silently skipped
 * the URL refresh — FFmpeg reused the same stale signed URL forever.
 *
 * Evidence from prod logs:
 *   - `FFmpeg CDN failure detected`:    600
 *   - `Refreshed audio URL for retry`:    0
 *   - `Failed to refresh audio URL`:      0
 *
 * Every single existing retry-path unit test worked around this by explicitly
 * doing `player.extractor = { getAudioStreamUrl: jest.fn() }` in setup, which
 * is exactly the pattern that masked this bug for weeks. This test pins the
 * wiring at the AudioManager boundary so the mask can't come back.
 */

jest.mock("child_process", () => ({ spawn: jest.fn(), execFile: jest.fn() }));
jest.mock("../../src/services/logger_service", () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const AudioManager = require("../../src/session/audio_manager");
const AudioPlayer = require("../../src/audio/audio_player");

function mkSessionManager() {
  const sessions = new Map();
  return {
    get(guildId) {
      if (!sessions.has(guildId)) sessions.set(guildId, {});
      return sessions.get(guildId);
    },
  };
}

describe("regression: AudioManager forwards extractor to AudioPlayer", () => {
  test("getPlayer() on a new guild returns a player whose .extractor is the one held by AudioManager", () => {
    const extractor = { getAudioStreamUrl: jest.fn(), extractAudio: jest.fn() };
    const mgr = new AudioManager(mkSessionManager(), extractor);

    const player = mgr.getPlayer("guild-1");

    expect(player).toBeInstanceOf(AudioPlayer);
    expect(player.extractor).toBe(extractor);
    // Defensive: strict identity, not just "truthy" — the retry path
    // actually calls `this.extractor.getAudioStreamUrl(...)`.
    expect(typeof player.extractor.getAudioStreamUrl).toBe("function");
  });

  test("setExtractor() after getPlayer() does NOT retroactively patch existing players", () => {
    // This is the other half of the contract: AudioManager must hold the
    // extractor BEFORE getPlayer() is called, otherwise the player is born
    // broken. The startup composition root (src/index.js) is responsible
    // for ordering — this test documents that order so nobody re-breaks it.
    const mgr = new AudioManager(mkSessionManager(), null);
    const player = mgr.getPlayer("guild-1");
    expect(player.extractor).toBeNull();

    const extractor = { getAudioStreamUrl: jest.fn(), extractAudio: jest.fn() };
    mgr.setExtractor(extractor);

    // The already-created player is still orphaned — getPlayer returns the
    // same cached instance.
    expect(mgr.getPlayer("guild-1").extractor).toBeNull();
  });

  test("getPlayer() on a second guild also forwards the extractor", () => {
    // Guards against a future "lazy one-shot wiring" regression where the
    // extractor is somehow consumed by the first call.
    const extractor = { getAudioStreamUrl: jest.fn(), extractAudio: jest.fn() };
    const mgr = new AudioManager(mkSessionManager(), extractor);

    mgr.getPlayer("guild-1");
    const p2 = mgr.getPlayer("guild-2");

    expect(p2.extractor).toBe(extractor);
  });

  test("getPlayer() forwards the YouTube extractor for stale YouTube URL refreshes", () => {
    const bilibiliExtractor = { getAudioStreamUrl: jest.fn(), extractAudio: jest.fn() };
    const youtubeExtractor = { getAudioStreamUrl: jest.fn(), extractAudio: jest.fn() };
    const mgr = new AudioManager(mkSessionManager(), bilibiliExtractor, youtubeExtractor);

    const player = mgr.getPlayer("guild-1");

    expect(player.getRefreshExtractor({
      platform: "youtube",
      normalizedUrl: "https://www.youtube.com/watch?v=abc",
    })).toBe(youtubeExtractor);
  });
});
