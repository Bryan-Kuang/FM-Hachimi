const { resolveSpotifyPlayback } = require("../../src/spotify/playback_resolver");

function meta(overrides = {}) {
  return { id: "track1", title: "Song", artists: ["Artist"], durationSec: 180, ...overrides };
}

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
