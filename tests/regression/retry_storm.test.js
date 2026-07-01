/**
 * Regression: exhausted CDN retries must DROP the track, not resurrect it.
 *
 * Production incident 2026-07-01: YouTube began rejecting TV-client stream
 * URLs with 403. retryCurrentTrack() gave up after max attempts and called
 * handleTrackEnd() — but with loopMode 'queue' and a single-track queue,
 * advance() wrapped around and served the SAME track again. Its retryCount
 * was deliberately preserved (>2), so the next idle event short-circuited
 * straight back to "max retries reached" with no backoff and no URL refresh:
 * an infinite ~1 req/sec loop that hammered YouTube for 2000+ requests.
 *
 * The fix: when retries are exhausted the track is removed from the queue
 * (Queue.dropCurrent), so advance() can never serve it again. A single-track
 * queue then ends playback; a multi-track queue moves to the next track.
 */

jest.mock("child_process", () => ({ spawn: jest.fn(), execFile: jest.fn() }));
jest.mock("../../src/services/logger_service", () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const AudioPlayer = require("../../src/audio/audio_player");
const Queue = require("../../src/audio/queue");
const Track = require("../../src/models/track");

const makeTrack = (title) =>
  new Track({ title, url: `https://youtube.com/watch?v=${title}`, audioUrl: "https://cdn/a.webm", duration: 93 }, "user");

describe("Queue.dropCurrent", () => {
  let queue;

  beforeEach(() => {
    queue = new Queue();
  });

  test("single-track queue-loop: after drop, advance() ends instead of wrapping", () => {
    const bad = makeTrack("bad");
    queue.items = [bad];
    queue.currentIndex = 0;
    queue.currentTrack = bad;
    queue.setLoopMode("queue");

    const dropped = queue.dropCurrent();

    expect(dropped).toBe(bad);
    expect(queue.length).toBe(0);
    expect(queue.advance()).toEqual({ track: null, ended: true });
  });

  test("dropping the current track advances to its successor", () => {
    const [a, b, c] = [makeTrack("a"), makeTrack("b"), makeTrack("c")];
    queue.items = [a, b, c];
    queue.currentIndex = 1;
    queue.currentTrack = b;

    queue.dropCurrent();

    expect(queue.items).toEqual([a, c]);
    expect(queue.advance().track).toBe(c);
  });

  test("dropping the last track under queue-loop wraps to the first", () => {
    const [a, b] = [makeTrack("a"), makeTrack("b")];
    queue.items = [a, b];
    queue.currentIndex = 1;
    queue.currentTrack = b;
    queue.setLoopMode("queue");

    queue.dropCurrent();

    expect(queue.items).toEqual([a]);
    expect(queue.advance().track).toBe(a);
  });

  test("dropCurrent with no current track is a no-op", () => {
    expect(queue.dropCurrent()).toBeNull();
    expect(queue.length).toBe(0);
  });

  test("dropped track can no longer be resurrected by track-loop", () => {
    const bad = makeTrack("bad");
    queue.items = [bad];
    queue.currentIndex = 0;
    queue.currentTrack = bad;
    queue.setLoopMode("track");

    queue.dropCurrent();

    // track-loop advance() must not return the dropped track
    expect(queue.advance()).toEqual({ track: null, ended: true });
  });
});

describe("regression: exhausted retries drop the track (2026-07-01 retry storm)", () => {
  let player;

  beforeEach(() => {
    player = new AudioPlayer();
    player.voiceConnection = { destroy: jest.fn() };
    player.audioPlayer = { stop: jest.fn() };
    player.playCurrentTrack = jest.fn().mockResolvedValue(true);
    player._enterIdle = jest.fn();
  });

  afterEach(() => jest.clearAllTimers());

  test("single-track queue-loop: exhausted track is dropped, playback stops (no storm)", async () => {
    const bad = makeTrack("O Canada");
    bad.retryCount = 3; // retries already exhausted
    player.queue.items = [bad];
    player.queue.currentIndex = 0;
    player.queue.currentTrack = bad;
    player.queue.setLoopMode("queue");

    await player.retryCurrentTrack();

    // The storm: playCurrentTrack was called again with the same dead track.
    expect(player.playCurrentTrack).not.toHaveBeenCalled();
    expect(player.queue.length).toBe(0);
    expect(player.isPlaying).toBe(false);
    expect(player._enterIdle).toHaveBeenCalled();
  });

  test("multi-track queue: exhausted track is dropped, next track plays", async () => {
    const bad = makeTrack("bad");
    const good = makeTrack("good");
    bad.retryCount = 3;
    player.queue.items = [bad, good];
    player.queue.currentIndex = 0;
    player.queue.currentTrack = bad;
    player.queue.setLoopMode("queue");

    await player.retryCurrentTrack();

    expect(player.queue.items).toEqual([good]);
    expect(player.queue.currentTrack).toBe(good);
    expect(player.playCurrentTrack).toHaveBeenCalledTimes(1);
  });

  test("track-loop mode: exhausted track is dropped instead of looping forever", async () => {
    const bad = makeTrack("bad");
    bad.retryCount = 3;
    player.queue.items = [bad];
    player.queue.currentIndex = 0;
    player.queue.currentTrack = bad;
    player.queue.setLoopMode("track");

    await player.retryCurrentTrack();

    expect(player.playCurrentTrack).not.toHaveBeenCalled();
    expect(player.queue.length).toBe(0);
  });
});
