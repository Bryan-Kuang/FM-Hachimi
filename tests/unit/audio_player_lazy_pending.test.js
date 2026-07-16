/**
 * AudioPlayer lazy-extraction seam hardening (Task 2.1).
 * A "pending" bulk-enqueued track has audioUrl: '', normalizedUrl set, and
 * extractedAt pinned to the epoch (always expired) — playCurrentTrack() must
 * refresh it before building an audio resource, and must drop+skip (not
 * spawn ffmpeg against '') when that refresh fails.
 */

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
const Track = require("../../src/models/track");

function makePendingTrack(overrides = {}) {
  return new Track({
    title: "Pending Playlist Track",
    normalizedUrl: "https://www.youtube.com/watch?v=abc123",
    audioUrl: "",
    duration: 0,
    platform: "youtube",
    extractedAt: new Date(0).toISOString(),
    ...overrides,
  }, "user");
}

describe("AudioPlayer lazy-extraction seam (pending playlist tracks)", () => {
  let player;

  beforeEach(() => {
    jest.clearAllMocks();
    player = new AudioPlayer();
    player.voiceConnection = { state: { status: "ready" } };
    // Skip real ffmpeg/discordjs resource creation — only the refresh seam
    // is under test here.
    player.createAudioResource = jest.fn().mockResolvedValue({ fake: true });
  });

  afterEach(() => {
    jest.clearAllTimers();
  });

  test("refreshes a pending track's audioUrl via the platform extractor before building a resource", async () => {
    const youtubeExtractor = { getAudioStreamUrl: jest.fn().mockResolvedValue("https://cdn/fresh.m4a") };
    player.setExtractorForPlatform("youtube", youtubeExtractor);
    player.currentTrack = makePendingTrack();

    const result = await player.playCurrentTrack();

    expect(result).toBe(true);
    expect(youtubeExtractor.getAudioStreamUrl).toHaveBeenCalledWith("https://www.youtube.com/watch?v=abc123");
    expect(player.currentTrack.audioUrl).toBe("https://cdn/fresh.m4a");
    expect(player.currentTrack.extractedAt).not.toBe(new Date(0).toISOString());
    expect(player.createAudioResource).toHaveBeenCalledWith("https://cdn/fresh.m4a", 0);
  });

  test("drops and skips the track when refresh fails and there is no fallback audioUrl", async () => {
    const youtubeExtractor = { getAudioStreamUrl: jest.fn().mockRejectedValue(new Error("network down")) };
    player.setExtractorForPlatform("youtube", youtubeExtractor);
    player.currentTrack = makePendingTrack();
    player.queue.items = [player.currentTrack];
    player.queue.currentIndex = 0;

    player.skip = jest.fn().mockResolvedValue(true);
    const dropSpy = jest.spyOn(player.queue, "dropCurrent");

    const result = await player.playCurrentTrack();

    expect(dropSpy).toHaveBeenCalled();
    expect(player.skip).toHaveBeenCalledWith("ended");
    expect(player.createAudioResource).not.toHaveBeenCalled();
    expect(result).toBe(true); // resolves to whatever skip() returned
  });

  test("drops and skips when no extractor is configured for the pending track's platform", async () => {
    // No setExtractorForPlatform call — youtube extractor is unset.
    player.currentTrack = makePendingTrack();
    player.queue.items = [player.currentTrack];
    player.queue.currentIndex = 0;

    player.skip = jest.fn().mockResolvedValue(true);
    const dropSpy = jest.spyOn(player.queue, "dropCurrent");

    await player.playCurrentTrack();

    expect(dropSpy).toHaveBeenCalled();
    expect(player.skip).toHaveBeenCalledWith("ended");
    expect(player.createAudioResource).not.toHaveBeenCalled();
  });

  test("cached:true tracks never trigger a refresh even when audioUrl is empty-ish stale", async () => {
    const youtubeExtractor = { getAudioStreamUrl: jest.fn() };
    player.setExtractorForPlatform("youtube", youtubeExtractor);
    player.currentTrack = makePendingTrack({ audioUrl: "/local/cached/file.m4a", cached: true });

    const result = await player.playCurrentTrack();

    expect(youtubeExtractor.getAudioStreamUrl).not.toHaveBeenCalled();
    expect(result).toBe(true);
    expect(player.createAudioResource).toHaveBeenCalledWith("/local/cached/file.m4a", 0);
  });

  test("does not refresh a track with a live (non-expired, non-empty) audioUrl", async () => {
    const youtubeExtractor = { getAudioStreamUrl: jest.fn() };
    player.setExtractorForPlatform("youtube", youtubeExtractor);
    player.currentTrack = makePendingTrack({
      audioUrl: "https://cdn/still-fresh.m4a",
      extractedAt: new Date().toISOString(),
    });

    await player.playCurrentTrack();

    expect(youtubeExtractor.getAudioStreamUrl).not.toHaveBeenCalled();
  });
});
