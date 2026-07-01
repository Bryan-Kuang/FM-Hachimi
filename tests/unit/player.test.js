jest.mock("child_process", () => ({
  spawn: jest.fn(),
  execFile: jest.fn(),
}));

jest.mock("../../src/services/logger_service", () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

const AudioPlayer = require("../../src/audio/audio_player");

describe("AudioPlayer", () => {
  let player;

  beforeEach(() => {
    player = new AudioPlayer();
    jest.clearAllMocks();
  });

  afterEach(() => {
    // Clear any pending timers from retryCurrentTrack
    jest.clearAllTimers();
  });

  // ─── isCdnFailure ────────────────────────────────────────────

  describe("isCdnFailure", () => {
    test.each([
      [255, "Will reconnect at 123 in 0 second(s), error=End of file.", true],
      [255, "Server returned 403 Forbidden", true],
      [255, "Server returned 503 Service Unavailable", true],
      [255, "Connection reset by peer", true],
      [255, "Connection refused", true],
      [255, "Connection timed out", true],
      [255, "I/O error reading from network", true],
      [255, "HTTP error 404 Not Found", true],
    ])("code=%i stderr='%s' → %s", (code, stderr, expected) => {
      expect(player.isCdnFailure(code, stderr)).toBe(expected);
    });

    test("returns false for non-255 exit codes", () => {
      expect(player.isCdnFailure(1, "End of file")).toBe(false);
      expect(player.isCdnFailure(0, "End of file")).toBe(false);
      expect(player.isCdnFailure(137, "End of file")).toBe(false);
    });

    test("returns false for non-CDN errors with code 255", () => {
      expect(player.isCdnFailure(255, "Invalid data found when processing input")).toBe(false);
      expect(player.isCdnFailure(255, "No such file or directory")).toBe(false);
      expect(player.isCdnFailure(255, "")).toBe(false);
    });
  });

  // ─── _cdnRetryPending flag ───────────────────────────────────

  describe("_cdnRetryPending flag", () => {
    test("is initialized to false", () => {
      expect(player._cdnRetryPending).toBe(false);
    });

    test("retryCurrentTrack clears the flag", async () => {
      player._cdnRetryPending = true;
      player.currentTrack = null; // will early-return but still clears flag

      await player.retryCurrentTrack();

      expect(player._cdnRetryPending).toBe(false);
    });
  });

  // ─── retryCurrentTrack ──────────────────────────────────────

  describe("retryCurrentTrack", () => {
    test("does nothing if no current track", async () => {
      player.currentTrack = null;

      await player.retryCurrentTrack();

      // Should not throw
      expect(player._cdnRetryPending).toBe(false);
    });

    test("increments retryCount", async () => {
      jest.useFakeTimers();
      const Track = require("../../src/models/track");
      player.currentTrack = new Track({ title: "Test", normalizedUrl: null, bvid: "BVtest", audioUrl: "url", duration: 180 }, "user");
      // Prevent actual playback attempt by mocking playCurrentTrack
      player.playCurrentTrack = jest.fn().mockResolvedValue(true);

      await player.retryCurrentTrack();

      expect(player.currentTrack.retryCount).toBe(1);

      // Advance past the 2-second retry delay to clear the timer
      jest.advanceTimersByTime(3000);
      jest.useRealTimers();
    });

    test("drops track from queue after max retries (>2)", async () => {
      const Track = require("../../src/models/track");
      const track = new Track({ title: "Test", normalizedUrl: null, bvid: "BVtest", audioUrl: "url", duration: 180 }, "user");
      track.retryCount = 2; // set after construction
      player.queue.items = [track];
      player.queue.currentIndex = 0;
      player.currentTrack = track;
      player.playCurrentTrack = jest.fn().mockResolvedValue(true);

      await player.retryCurrentTrack();

      // retryCount becomes 3, exceeds max of 2 → track removed from queue so
      // queue-loop cannot resurrect it (2026-07-01 retry storm regression)
      expect(player.queue.length).toBe(0);
      expect(player.playCurrentTrack).not.toHaveBeenCalled();
    });

    test("refreshes stale YouTube tracks with the YouTube extractor", async () => {
      const Track = require("../../src/models/track");
      const bilibiliExtractor = { getAudioStreamUrl: jest.fn().mockResolvedValue("bili-fresh-url") };
      const youtubeExtractor = { getAudioStreamUrl: jest.fn().mockResolvedValue("yt-fresh-url") };
      player = new AudioPlayer(bilibiliExtractor, { youtube: youtubeExtractor });
      player.currentTrack = new Track({
        title: "YouTube Track",
        normalizedUrl: "https://www.youtube.com/watch?v=abc",
        audioUrl: "old-url",
        duration: 180,
        platform: "youtube",
        extractedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString()
      }, "user");
      player.playCurrentTrack = jest.fn().mockResolvedValue(true);

      await player.retryCurrentTrack();

      expect(youtubeExtractor.getAudioStreamUrl).toHaveBeenCalledWith("https://www.youtube.com/watch?v=abc");
      expect(bilibiliExtractor.getAudioStreamUrl).not.toHaveBeenCalled();
      expect(player.currentTrack.audioUrl).toBe("yt-fresh-url");
    });

    test("infers YouTube extractor for old queued tracks without platform metadata", async () => {
      const Track = require("../../src/models/track");
      const bilibiliExtractor = { getAudioStreamUrl: jest.fn().mockResolvedValue("bili-fresh-url") };
      const youtubeExtractor = { getAudioStreamUrl: jest.fn().mockResolvedValue("yt-fresh-url") };
      player = new AudioPlayer(bilibiliExtractor, { youtube: youtubeExtractor });
      player.currentTrack = new Track({
        title: "Legacy YouTube Track",
        normalizedUrl: "https://youtu.be/abc",
        audioUrl: "old-url",
        duration: 180,
        extractedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString()
      }, "user");
      player.playCurrentTrack = jest.fn().mockResolvedValue(true);

      await player.retryCurrentTrack();

      expect(youtubeExtractor.getAudioStreamUrl).toHaveBeenCalledWith("https://youtu.be/abc");
      expect(bilibiliExtractor.getAudioStreamUrl).not.toHaveBeenCalled();
    });
  });

  // ─── Queue operations ────────────────────────────────────────

  describe("queue management", () => {
    test("addToQueue adds tracks", () => {
      const track = { bvid: "BVa", title: "Song A", audioUrl: "url", duration: 100 };
      player.addToQueue(track, "<@user>");

      expect(player.queue.length).toBe(1);
      expect(player.queue.items[0].title).toBe("Song A");
    });

    test("clearQueue empties the queue (keeps current track)", () => {
      player.addToQueue({ bvid: "BVa", title: "A", audioUrl: "u1", duration: 100 }, "<@user>");
      player.addToQueue({ bvid: "BVb", title: "B", audioUrl: "u2", duration: 100 }, "<@user>");
      player.currentIndex = 0;
      player.currentTrack = player.queue.items[0];

      player.clearQueue();

      // clearQueue keeps only the current track
      expect(player.queue.length).toBe(1);
      expect(player.queue.items[0].title).toBe("A");
    });

    test("getFormattedQueue returns formatted entries", () => {
      player.addToQueue({ bvid: "BVa", title: "Song A", audioUrl: "u1", duration: 125 }, "User1");
      player.addToQueue({ bvid: "BVb", title: "Song B", audioUrl: "u2", duration: 63 }, "User2");

      const formatted = player.getFormattedQueue();

      expect(formatted).toHaveLength(2);
      expect(formatted[0].title).toBe("Song A");
      expect(formatted[1].title).toBe("Song B");
    });
  });

  // ─── Loop mode ───────────────────────────────────────────────

  describe("loop mode", () => {
    test("defaults to queue loop", () => {
      expect(player.loopMode).toBe("queue");
    });

    test("setLoopMode sets valid modes", () => {
      player.setLoopMode("track");
      expect(player.loopMode).toBe("track");

      player.setLoopMode("none");
      expect(player.loopMode).toBe("none");

      player.setLoopMode("queue");
      expect(player.loopMode).toBe("queue");
    });

    test("setLoopMode ignores invalid modes", () => {
      player.setLoopMode("invalid");
      expect(player.loopMode).toBe("queue"); // unchanged from default
    });
  });

  // ─── _manualNavigating guard (regression: issue #2 double-skip) ──

  describe("_manualNavigating guard", () => {
    test("is initialized to false", () => {
      expect(player._manualNavigating).toBe(false);
    });

    test("_handleIdle ignores event and clears flag when manual navigation is in progress", () => {
      player._manualNavigating = true;
      player.currentTrack = { title: "Song 2" };
      player.handleTrackEnd = jest.fn();

      player._handleIdle();

      expect(player._manualNavigating).toBe(false);
      expect(player.handleTrackEnd).not.toHaveBeenCalled();
    });

    test("_handleIdle processes normally when flag is false and track played long enough", () => {
      player._manualNavigating = false;
      player.currentTrack = { title: "Song 1", duration: 300 };
      player.startTime = Date.now() - 5000; // 5s ago > 3s threshold
      player.handleTrackEnd = jest.fn();

      player._handleIdle();

      expect(player.handleTrackEnd).toHaveBeenCalled();
    });

    test("skip sets _manualNavigating flag and resets startTime", async () => {
      player.addToQueue({ bvid: "BV1", title: "Song 1", audioUrl: "url1", duration: 180 }, "<@user>");
      player.addToQueue({ bvid: "BV2", title: "Song 2", audioUrl: "url2", duration: 180 }, "<@user>");
      player.currentIndex = 0;
      player.currentTrack = player.queue.items[0];
      player.startTime = Date.now() - 30 * 60 * 1000; // stale: 30 min ago
      player.setLoopMode("none");
      player.voiceConnection = null;

      await player.skip();

      // No voice connection → flag should be cleared synchronously
      expect(player._manualNavigating).toBe(false);
      // startTime should have been reset
      expect(player.startTime).toBeNull();
    });

    test("previous sets _manualNavigating flag and resets startTime", async () => {
      player.addToQueue({ bvid: "BV1", title: "Song 1", audioUrl: "url1", duration: 180 }, "<@user>");
      player.addToQueue({ bvid: "BV2", title: "Song 2", audioUrl: "url2", duration: 180 }, "<@user>");
      player.currentIndex = 1;
      player.currentTrack = player.queue.items[1];
      player.startTime = Date.now() - 30 * 60 * 1000;
      player.setLoopMode("none");
      player.voiceConnection = null;

      await player.previous();

      expect(player._manualNavigating).toBe(false);
      expect(player.startTime).toBeNull();
    });

    test("regression #2: skip does not double-advance queue via stale Idle event", async () => {
      player.addToQueue({ bvid: "BV1", title: "Song 1", audioUrl: "url1", duration: 180 }, "<@user>");
      player.addToQueue({ bvid: "BV2", title: "Song 2", audioUrl: "url2", duration: 180 }, "<@user>");
      player.addToQueue({ bvid: "BV3", title: "Song 3", audioUrl: "url3", duration: 180 }, "<@user>");
      player.currentIndex = 1; // on song 2
      player.currentTrack = player.queue.items[1];
      player.startTime = Date.now() - 30 * 60 * 1000; // 30 min ago (stale)
      player.setLoopMode("queue");
      player.voiceConnection = null;
      player.handleTrackEnd = jest.fn();

      // User skips song 2
      await player.skip();
      expect(player.currentIndex).toBe(2); // should be on song 3

      // Simulate stale Idle event arriving after skip
      player._manualNavigating = true; // restored as it would be mid-playCurrentTrack
      player._handleIdle();

      // handleTrackEnd must NOT be called — the guard prevented the double-skip
      expect(player.handleTrackEnd).not.toHaveBeenCalled();
      expect(player.currentIndex).toBe(2); // still song 3, not song 4
    });
  });

  // ─── getState ────────────────────────────────────────────────

  describe("getState", () => {
    test("returns current player state snapshot", () => {
      player.isPlaying = true;
      player.isPaused = false;
      player.addToQueue({ bvid: "BVa", title: "A", audioUrl: "u1", duration: 100 }, "<@user>");
      player.addToQueue({ bvid: "BVb", title: "B", audioUrl: "u2", duration: 100 }, "<@user>");
      player.currentIndex = 0;
      player.currentTrack = player.queue.items[0];
      player.setLoopMode("track");

      const state = player.getState();

      expect(state.isPlaying).toBe(true);
      expect(state.isPaused).toBe(false);
      expect(state.queueLength).toBe(2);
      expect(state.currentTrack.title).toBe("A");
      expect(state.loopMode).toBe("track");
    });
  });
});
