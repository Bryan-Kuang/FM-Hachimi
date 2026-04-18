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

const AudioPlayer = require("../../src/playback/audio_player");

const makeQueue = (n) =>
  Array.from({ length: n }, (_, i) => ({
    title: `Song ${i + 1}`,
    audioUrl: `url${i + 1}`,
    duration: 180,
    resetRetry: jest.fn(),
  }));

describe("regression: loop mode transitions", () => {
  let player;

  beforeEach(() => {
    player = new AudioPlayer();
    player.playCurrentTrack = jest.fn().mockResolvedValue(true);
  });

  afterEach(() => jest.clearAllTimers());

  describe("loopMode=track", () => {
    test("handleTrackEnd replays same track, resets retry count", async () => {
      player.queue = makeQueue(3);
      player.currentIndex = 1;
      player.currentTrack = player.queue[1];
      player.loopMode = "track";

      await player.handleTrackEnd();

      expect(player.currentIndex).toBe(1);
      expect(player.currentTrack.resetRetry).toHaveBeenCalled();
      expect(player.playCurrentTrack).toHaveBeenCalledTimes(1);
    });

    test("skip breaks out of track loop and advances to next", async () => {
      player.queue = makeQueue(3);
      player.currentIndex = 1;
      player.currentTrack = player.queue[1];
      player.loopMode = "track";
      player.voiceConnection = null;

      await player.skip();

      expect(player.currentIndex).toBe(2);
    });
  });

  describe("loopMode=queue", () => {
    test("skip at end wraps to index 0", async () => {
      player.queue = makeQueue(3);
      player.currentIndex = 2;
      player.currentTrack = player.queue[2];
      player.loopMode = "queue";
      player.voiceConnection = null;

      await player.skip();

      expect(player.currentIndex).toBe(0);
    });

    test("previous at index 0 wraps to last track", async () => {
      player.queue = makeQueue(3);
      player.currentIndex = 0;
      player.currentTrack = player.queue[0];
      player.loopMode = "queue";
      player.voiceConnection = null;

      await player.previous();

      expect(player.currentIndex).toBe(2);
    });

    test("handleTrackEnd at last index calls skip which wraps", async () => {
      player.queue = makeQueue(3);
      player.currentIndex = 2;
      player.currentTrack = player.queue[2];
      player.loopMode = "queue";
      player.voiceConnection = null;

      await player.handleTrackEnd();

      expect(player.currentIndex).toBe(0);
    });
  });

  describe("loopMode=none", () => {
    test("skip past last track stops playback", async () => {
      player.queue = makeQueue(2);
      player.currentIndex = 1;
      player.currentTrack = player.queue[1];
      player.loopMode = "none";
      player.voiceConnection = null;
      player._doDisconnect = jest.fn();

      const result = await player.skip();

      expect(result).toBe(false);
      expect(player.currentTrack).toBeNull();
      expect(player.currentIndex).toBe(-1);
      expect(player.isPlaying).toBe(false);
    });

    test("previous at index 0 returns false, does not wrap", async () => {
      player.queue = makeQueue(3);
      player.currentIndex = 0;
      player.currentTrack = player.queue[0];
      player.loopMode = "none";
      player.voiceConnection = null;

      const result = await player.previous();

      expect(result).toBe(false);
      expect(player.currentIndex).toBe(0);
    });

    test("handleTrackEnd with loopMode=none does NOT replay (hachimi-repeat regression)", async () => {
      player.queue = makeQueue(2);
      player.currentIndex = 0;
      player.currentTrack = player.queue[0];
      player.loopMode = "none";
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
