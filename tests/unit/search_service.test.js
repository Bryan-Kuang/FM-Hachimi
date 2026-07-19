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

  test("Bilibili and YouTube failures fall back to [] independently (Promise.allSettled) and log a warning", async () => {
    const SearchService = require("../../src/search/search_service");

    const result = await SearchService.searchDualPlatforms({
      keyword: "hachimi",
      limitPerPlatform: 5,
      bilibiliApi: { searchVideos: jest.fn().mockRejectedValue(new Error("bili down")) },
      youtubeExtractor: { searchVideos: jest.fn().mockRejectedValue(new Error("yt down")) },
    });

    expect(result.bilibili).toEqual([]);
    expect(result.youtube).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      "Bilibili search failed during dual-platform search",
      expect.objectContaining({ keyword: "hachimi", error: "bili down" }),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      "YouTube search failed during dual-platform search",
      expect.objectContaining({ keyword: "hachimi", error: "yt down" }),
    );
  });
});
