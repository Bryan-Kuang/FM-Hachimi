const { buildSearchQuery, buildLazySearchUrl, findYouTubeMatch } = require("../../src/spotify/resolver");

describe("spotify resolver", () => {
  describe("buildSearchQuery", () => {
    test("joins first artist and title", () => {
      const q = buildSearchQuery({ title: "Song Title", artists: ["Artist A", "Artist B"], durationSec: 200 });
      expect(q).toBe("Artist A Song Title");
    });

    test("handles no artists gracefully", () => {
      const q = buildSearchQuery({ title: "Song Title", artists: [], durationSec: 200 });
      expect(q).toBe("Song Title");
    });
  });

  describe("buildLazySearchUrl", () => {
    test("formats as ytsearch1:<query>", () => {
      const url = buildLazySearchUrl({ title: "Song Title", artists: ["Artist A"], durationSec: 200 });
      expect(url).toBe("ytsearch1:Artist A Song Title");
    });
  });

  describe("findYouTubeMatch", () => {
    const track = { title: "Song Title", artists: ["Artist A"], durationSec: 200 };

    test("picks the result closest in duration", async () => {
      const youtubeExtractor = {
        searchVideos: jest.fn().mockResolvedValue({
          success: true,
          results: [
            { url: "https://youtube.com/watch?v=far", title: "Far", duration: 100 },
            { url: "https://youtube.com/watch?v=close", title: "Close", duration: 205 },
            { url: "https://youtube.com/watch?v=mid", title: "Mid", duration: 240 },
          ],
        }),
      };

      const match = await findYouTubeMatch(track, youtubeExtractor);
      expect(match).toEqual({ url: "https://youtube.com/watch?v=close", title: "Close" });
      expect(youtubeExtractor.searchVideos).toHaveBeenCalledWith("Artist A Song Title", 5);
    });

    test("falls back to the first result when none are within 15s", async () => {
      const youtubeExtractor = {
        searchVideos: jest.fn().mockResolvedValue({
          success: true,
          results: [
            { url: "https://youtube.com/watch?v=first", title: "First", duration: 50 },
            { url: "https://youtube.com/watch?v=second", title: "Second", duration: 900 },
          ],
        }),
      };

      const match = await findYouTubeMatch(track, youtubeExtractor);
      expect(match).toEqual({ url: "https://youtube.com/watch?v=first", title: "First" });
    });

    test("returns null on empty results", async () => {
      const youtubeExtractor = {
        searchVideos: jest.fn().mockResolvedValue({ success: true, results: [] }),
      };

      const match = await findYouTubeMatch(track, youtubeExtractor);
      expect(match).toBeNull();
    });

    test("returns null when search reports failure", async () => {
      const youtubeExtractor = {
        searchVideos: jest.fn().mockResolvedValue({ success: false }),
      };

      const match = await findYouTubeMatch(track, youtubeExtractor);
      expect(match).toBeNull();
    });

    test("returns null when searchVideos throws", async () => {
      const youtubeExtractor = {
        searchVideos: jest.fn().mockRejectedValue(new Error("yt-dlp failed")),
      };

      const match = await findYouTubeMatch(track, youtubeExtractor);
      expect(match).toBeNull();
    });

    test("accepts a result exactly at the 15s boundary", async () => {
      const youtubeExtractor = {
        searchVideos: jest.fn().mockResolvedValue({
          success: true,
          results: [
            { url: "https://youtube.com/watch?v=boundary", title: "Boundary", duration: 215 },
            { url: "https://youtube.com/watch?v=other", title: "Other", duration: 500 },
          ],
        }),
      };

      const match = await findYouTubeMatch(track, youtubeExtractor);
      expect(match).toEqual({ url: "https://youtube.com/watch?v=boundary", title: "Boundary" });
    });
  });
});
