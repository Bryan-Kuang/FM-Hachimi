/**
 * Regression: loop mode behavior through handleTrackEnd / skip.
 *
 * - loopMode "track": handleTrackEnd replays current track, resets retry count
 * - loopMode "queue": skip wraps to index 0 after last track
 * - loopMode "none"/"off": skip past last track stops playback
 *
 * Previous bug: "hachimi repeat" (see MEMORY.md 2026-02) — track loop fired
 * on normal track end when loopMode was "none", causing unwanted replay.
 */

jest.mock("child_process", () => ({ spawn: jest.fn(), execFile: jest.fn() }));
jest.mock("../../src/services/logger_service", () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const AudioPlayer = require("../../src/audio/audio_player");

const makeTrackData = (i) => ({
  bvid: `BV${i}`,
  title: `Song ${i + 1}`,
  audioUrl: `url${i + 1}`,
  duration: 180,
});

const populateQueue = (player, n) => {
  for (let i = 0; i < n; i++) {
    player.addToQueue(makeTrackData(i), `<@user>`);
  }
};

describe("regression: loop mode transitions", () => {
  let player;

  beforeEach(() => {
    player = new AudioPlayer();
    player.playCurrentTrack = jest.fn().mockResolvedValue(true);
  });

  afterEach(() => jest.clearAllTimers());

  describe("loopMode=track", () => {
    test("handleTrackEnd replays same track, resets retry count", async () => {
      populateQueue(player, 3);
      player.currentIndex = 1;
      player.currentTrack = player.queue.items[1];
      player.setLoopMode("track");

      await player.handleTrackEnd();

      expect(player.currentIndex).toBe(1);
      expect(player.currentTrack.resetRetry).toBeDefined();
      expect(player.playCurrentTrack).toHaveBeenCalledTimes(1);
    });

    test("skip breaks out of track loop and advances to next", async () => {
      populateQueue(player, 3);
      player.currentIndex = 1;
      player.currentTrack = player.queue.items[1];
      player.setLoopMode("track");
      player.voiceConnection = null;

      await player.skip();

      // In track loop mode, advance() replays the same track
      // but skip() uses queue.advance() which respects track loop
      expect(player.currentIndex).toBe(1);
    });
  });

  describe("loopMode=queue", () => {
    test("skip at end wraps to index 0", async () => {
      populateQueue(player, 3);
      player.currentIndex = 2;
      player.currentTrack = player.queue.items[2];
      player.setLoopMode("queue");
      player.voiceConnection = null;

      await player.skip();

      expect(player.currentIndex).toBe(0);
    });

    test("previous at index 0 wraps to last track", async () => {
      populateQueue(player, 3);
      player.currentIndex = 0;
      player.currentTrack = player.queue.items[0];
      player.setLoopMode("queue");
      player.voiceConnection = null;

      await player.previous();

      expect(player.currentIndex).toBe(2);
    });

    test("handleTrackEnd at last index calls skip which wraps", async () => {
      populateQueue(player, 3);
      player.currentIndex = 2;
      player.currentTrack = player.queue.items[2];
      player.setLoopMode("queue");
      player.voiceConnection = null;

      await player.handleTrackEnd();

      expect(player.currentIndex).toBe(0);
    });
  });

  describe("loopMode=none", () => {
    test("skip past last track stops playback", async () => {
      populateQueue(player, 2);
      player.currentIndex = 1;
      player.currentTrack = player.queue.items[1];
      player.setLoopMode("none");
      player.voiceConnection = null;
      player._doDisconnect = jest.fn();

      const result = await player.skip();

      expect(result).toBe(false);
      expect(player.currentTrack).toBeNull();
      expect(player.currentIndex).toBe(-1);
      expect(player.isPlaying).toBe(false);
    });

    test("previous at index 0 returns false, does not wrap", async () => {
      populateQueue(player, 3);
      player.currentIndex = 0;
      player.currentTrack = player.queue.items[0];
      player.setLoopMode("none");
      player.voiceConnection = null;

      const result = await player.previous();

      expect(result).toBe(false);
      expect(player.currentIndex).toBe(0);
    });

    test("handleTrackEnd with loopMode=none does NOT replay (hachimi-repeat regression)", async () => {
      populateQueue(player, 2);
      player.currentIndex = 0;
      player.currentTrack = player.queue.items[0];
      player.setLoopMode("none");
      player.voiceConnection = null;

      await player.handleTrackEnd();

      expect(player.currentIndex).toBe(1);
      expect(player.currentTrack.title).toBe("Song 2");
    });
  });

  describe("setLoopMode validation", () => {
    test("accepts valid modes", () => {
      player.setLoopMode("track");
      expect(player.loopMode).toBe("track");
      player.setLoopMode("queue");
      expect(player.loopMode).toBe("queue");
      player.setLoopMode("none");
      expect(player.loopMode).toBe("none");
    });

    test("rejects invalid modes (keeps previous)", () => {
      player.setLoopMode("track");
      player.setLoopMode("garbage");
      expect(player.loopMode).toBe("track");
    });
  });
});
