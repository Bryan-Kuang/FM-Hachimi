jest.mock("../../src/services/logger_service", () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

const { resolveSpotifyPlayback } = require("../../src/spotify/playback_resolver");

function meta(overrides = {}) {
  return { id: "track1", title: "Song", artists: ["Artist"], durationSec: 180, ...overrides };
}

function youtubeMatchExtractor(title = "Fallback match") {
  return {
    searchVideos: jest.fn().mockResolvedValue({
      success: true,
      results: [{ url: "https://www.youtube.com/watch?v=fallback", title, duration: 180 }],
    }),
  };
}

describe("resolveSpotifyPlayback (Project B: direct-first, YouTube fallback)", () => {
  test("direct extraction succeeds → kind:'direct', YouTube is never consulted", async () => {
    const directData = { title: "Song", audioUrl: "/cache/spotify/track1.ogg", duration: 180, cached: true, extractedAt: "2026-01-01T00:00:00.000Z" };
    const directExtractor = {
      isConfigured: jest.fn().mockReturnValue(true),
      extractAudio: jest.fn().mockResolvedValue(directData),
    };
    const youtubeExtractor = youtubeMatchExtractor();

    const target = await resolveSpotifyPlayback(meta(), { youtubeExtractor, directExtractor });

    expect(target).toEqual({ kind: "direct", data: directData });
    expect(directExtractor.extractAudio).toHaveBeenCalledWith("track1", { title: "Song", durationSec: 180 });
    expect(youtubeExtractor.searchVideos).not.toHaveBeenCalled();
  });

  test("directExtractor.isConfigured() false → skips straight to YouTube match", async () => {
    const directExtractor = {
      isConfigured: jest.fn().mockReturnValue(false),
      extractAudio: jest.fn(),
    };
    const youtubeExtractor = youtubeMatchExtractor("Matched via YouTube");

    const target = await resolveSpotifyPlayback(meta(), { youtubeExtractor, directExtractor });

    expect(directExtractor.extractAudio).not.toHaveBeenCalled();
    expect(target).toEqual({ kind: "youtube-url", url: "https://www.youtube.com/watch?v=fallback", title: "Matched via YouTube" });
  });

  test("direct extraction throws → falls back to YouTube match", async () => {
    const directExtractor = {
      isConfigured: jest.fn().mockReturnValue(true),
      extractAudio: jest.fn().mockRejectedValue(new Error("sidecar exited with code 1")),
    };
    const youtubeExtractor = youtubeMatchExtractor("Fallback after direct failure");

    const target = await resolveSpotifyPlayback(meta(), { youtubeExtractor, directExtractor });

    expect(target).toEqual({ kind: "youtube-url", url: "https://www.youtube.com/watch?v=fallback", title: "Fallback after direct failure" });
  });

  test("radioActive:true skips direct extraction even when configured", async () => {
    const directExtractor = {
      isConfigured: jest.fn().mockReturnValue(true),
      extractAudio: jest.fn().mockResolvedValue({ title: "Song", audioUrl: "/x.ogg", duration: 180, cached: true, extractedAt: "now" }),
    };
    const youtubeExtractor = youtubeMatchExtractor("Radio fallback match");

    const target = await resolveSpotifyPlayback(meta(), { youtubeExtractor, directExtractor, radioActive: true });

    expect(directExtractor.extractAudio).not.toHaveBeenCalled();
    expect(directExtractor.isConfigured).not.toHaveBeenCalled();
    expect(target).toEqual({ kind: "youtube-url", url: "https://www.youtube.com/watch?v=fallback", title: "Radio fallback match" });
  });

  test("both direct and YouTube fail → null", async () => {
    const directExtractor = {
      isConfigured: jest.fn().mockReturnValue(true),
      extractAudio: jest.fn().mockRejectedValue(new Error("no credentials")),
    };
    const youtubeExtractor = {
      searchVideos: jest.fn().mockResolvedValue({ success: true, results: [] }),
    };

    const target = await resolveSpotifyPlayback(meta(), { youtubeExtractor, directExtractor });

    expect(target).toBeNull();
  });

  test("no directExtractor provided (Project A callers) behaves exactly as before", async () => {
    const youtubeExtractor = youtubeMatchExtractor("No direct extractor at all");

    const target = await resolveSpotifyPlayback(meta(), { youtubeExtractor });

    expect(target).toEqual({ kind: "youtube-url", url: "https://www.youtube.com/watch?v=fallback", title: "No direct extractor at all" });
  });
});

describe("resolveSpotifyPlayback (Project A: YouTube-match implementation)", () => {
  test("resolves to a youtube-url target on a duration-close match", async () => {
    const youtubeExtractor = {
      searchVideos: jest.fn().mockResolvedValue({
        success: true,
        results: [
          { url: "https://www.youtube.com/watch?v=far", title: "Far match", duration: 10 },
          { url: "https://www.youtube.com/watch?v=close", title: "Close match", duration: 182 },
        ],
      }),
    };

    const target = await resolveSpotifyPlayback(meta(), { youtubeExtractor });

    expect(target).toEqual({
      kind: "youtube-url",
      url: "https://www.youtube.com/watch?v=close",
      title: "Close match",
    });
  });

  test("returns null when the YouTube search finds nothing", async () => {
    const youtubeExtractor = {
      searchVideos: jest.fn().mockResolvedValue({ success: true, results: [] }),
    };

    await expect(resolveSpotifyPlayback(meta(), { youtubeExtractor })).resolves.toBeNull();
  });

  test("returns null when the YouTube search throws", async () => {
    const youtubeExtractor = {
      searchVideos: jest.fn().mockRejectedValue(new Error("yt-dlp failed")),
    };

    await expect(resolveSpotifyPlayback(meta(), { youtubeExtractor })).resolves.toBeNull();
  });

  test("returns null when no youtubeExtractor is available", async () => {
    await expect(resolveSpotifyPlayback(meta(), { youtubeExtractor: null })).resolves.toBeNull();
    await expect(resolveSpotifyPlayback(meta(), { youtubeExtractor: undefined })).resolves.toBeNull();
  });
});
