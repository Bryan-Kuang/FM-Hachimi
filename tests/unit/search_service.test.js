jest.mock("../../src/utils/search_ranker", () => ({
  rankAndLimitSearchResults: jest.fn((results, keyword, limit) => {
    return [...results]
      .sort((a, b) => Number(b.title === keyword) - Number(a.title === keyword))
      .slice(0, limit);
  }),
}));

jest.mock("../../src/services/logger_service", () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

const SearchRanker = require("../../src/utils/search_ranker");
const logger = require("../../src/services/logger_service");

describe("SearchService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("dual search normalizes, ranks, and limits both platforms", async () => {
    const SearchService = require("../../src/search/search_service");
    const bilibiliApi = {
      searchVideos: jest.fn().mockResolvedValue([
        { title: "other", bvid: "BVother", author: "Bili Uploader", view: 100 },
        { title: "hachimi", bvid: "BVtarget", author: "Target Uploader", view: 500 },
      ]),
    };
    const youtubeExtractor = {
      searchVideos: jest.fn().mockResolvedValue({
        success: true,
        results: [
          { title: "other", id: "ytother0001" },
          { title: "hachimi", id: "yttarget001" },
        ],
      }),
    };

    const result = await SearchService.searchDualPlatforms({
      keyword: "hachimi",
      limitPerPlatform: 1,
      bilibiliApi,
      youtubeExtractor,
    });

    expect(bilibiliApi.searchVideos).toHaveBeenCalledWith("hachimi", 1, 1);
    expect(youtubeExtractor.searchVideos).toHaveBeenCalledWith("hachimi", 1);
    expect(result.bilibili).toEqual([
      expect.objectContaining({
        title: "hachimi",
        bvid: "BVtarget",
        uploader: "Target Uploader",
        viewCount: 500,
      }),
    ]);
    expect(result.youtube).toEqual([
      expect.objectContaining({ title: "hachimi", id: "yttarget001" }),
    ]);
    expect(result.rawBilibiliCount).toBe(2);
    expect(result.rawYouTubeCount).toBe(2);
    expect(SearchRanker.rankAndLimitSearchResults).toHaveBeenCalledTimes(2);
  });

  test("provider failures return empty result arrays instead of throwing", async () => {
    const SearchService = require("../../src/search/search_service");

    const result = await SearchService.searchDualPlatforms({
      keyword: "hachimi",
      limitPerPlatform: 5,
      bilibiliApi: { searchVideos: jest.fn().mockRejectedValue(new Error("bili down")) },
      youtubeExtractor: { searchVideos: jest.fn().mockRejectedValue(new Error("yt down")) },
    });

    expect(result).toEqual({
      bilibili: [],
      youtube: [],
      rawBilibiliCount: 0,
      rawYouTubeCount: 0,
    });
  });

  test("single-platform search accepts object and array response shapes", async () => {
    const SearchService = require("../../src/search/search_service");
    const extractor = {
      searchVideos: jest.fn().mockResolvedValue({
        success: true,
        results: [{ title: "hachimi", id: "BV1" }],
      }),
    };
    const api = {
      searchVideos: jest.fn().mockResolvedValue([{ title: "hachimi", bvid: "BV2" }]),
    };

    await expect(SearchService.searchBilibili({ keyword: "hachimi", limit: 5, extractor }))
      .resolves.toEqual([expect.objectContaining({ id: "BV1" })]);
    await expect(SearchService.searchBilibili({ keyword: "hachimi", limit: 5, bilibiliApi: api, source: "api" }))
      .resolves.toEqual([expect.objectContaining({ bvid: "BV2" })]);
  });

  describe("searchTriPlatforms", () => {
    test("searches all three platforms concurrently and ranks/limits bili+yt", async () => {
      const SearchService = require("../../src/search/search_service");
      const bilibiliApi = {
        searchVideos: jest.fn().mockResolvedValue([
          { title: "other", bvid: "BVother", author: "Bili Uploader", view: 100 },
          { title: "hachimi", bvid: "BVtarget", author: "Target Uploader", view: 500 },
        ]),
      };
      const youtubeExtractor = {
        searchVideos: jest.fn().mockResolvedValue({
          success: true,
          results: [{ title: "hachimi", id: "yttarget001" }],
        }),
      };
      const spotifyResults = [{ id: "spot1", title: "hachimi", artists: ["A"], durationSec: 100 }];
      const spotifyClient = { searchTracks: jest.fn().mockResolvedValue(spotifyResults) };

      const result = await SearchService.searchTriPlatforms({
        keyword: "hachimi",
        limitPerPlatform: 1,
        bilibiliApi,
        youtubeExtractor,
        spotifyClient,
      });

      expect(bilibiliApi.searchVideos).toHaveBeenCalledWith("hachimi", 1, 1);
      expect(youtubeExtractor.searchVideos).toHaveBeenCalledWith("hachimi", 1);
      expect(spotifyClient.searchTracks).toHaveBeenCalledWith("hachimi", 1);
      expect(result.bilibili).toEqual([
        expect.objectContaining({ title: "hachimi", bvid: "BVtarget", uploader: "Target Uploader", viewCount: 500 }),
      ]);
      expect(result.youtube).toEqual([expect.objectContaining({ title: "hachimi", id: "yttarget001" })]);
      expect(result.spotify).toEqual(spotifyResults);
      expect(result.rawBilibiliCount).toBe(2);
      expect(result.rawYouTubeCount).toBe(1);
    });

    test("a null Spotify client (disabled) contributes an empty list without calling anything", async () => {
      const SearchService = require("../../src/search/search_service");

      const result = await SearchService.searchTriPlatforms({
        keyword: "hachimi",
        limitPerPlatform: 5,
        bilibiliApi: { searchVideos: jest.fn().mockResolvedValue([]) },
        youtubeExtractor: { searchVideos: jest.fn().mockResolvedValue({ success: true, results: [] }) },
        spotifyClient: null,
      });

      expect(result.spotify).toEqual([]);
    });

    test("Spotify search failure (Promise.allSettled) falls back to [] and logs a warning, without affecting bili/yt", async () => {
      const SearchService = require("../../src/search/search_service");
      const bilibiliApi = { searchVideos: jest.fn().mockResolvedValue([{ title: "b", bvid: "BV1" }]) };
      const youtubeExtractor = {
        searchVideos: jest.fn().mockResolvedValue({ success: true, results: [{ title: "y", id: "ytid0000001" }] }),
      };
      const spotifyClient = { searchTracks: jest.fn().mockRejectedValue(new Error("spotify down")) };

      const result = await SearchService.searchTriPlatforms({
        keyword: "hachimi",
        limitPerPlatform: 5,
        bilibiliApi,
        youtubeExtractor,
        spotifyClient,
      });

      expect(result.spotify).toEqual([]);
      expect(result.bilibili).toHaveLength(1);
      expect(result.youtube).toHaveLength(1);
      expect(logger.warn).toHaveBeenCalledWith(
        "Spotify search failed during tri-platform search",
        expect.objectContaining({ keyword: "hachimi", error: "spotify down" }),
      );
    });

    test("Bilibili and YouTube failures also fall back to [] independently (Promise.allSettled)", async () => {
      const SearchService = require("../../src/search/search_service");

      const result = await SearchService.searchTriPlatforms({
        keyword: "hachimi",
        limitPerPlatform: 5,
        bilibiliApi: { searchVideos: jest.fn().mockRejectedValue(new Error("bili down")) },
        youtubeExtractor: { searchVideos: jest.fn().mockRejectedValue(new Error("yt down")) },
        spotifyClient: { searchTracks: jest.fn().mockResolvedValue([{ id: "s1", title: "s", artists: [], durationSec: 1 }]) },
      });

      expect(result.bilibili).toEqual([]);
      expect(result.youtube).toEqual([]);
      expect(result.spotify).toHaveLength(1);
    });
  });
});
