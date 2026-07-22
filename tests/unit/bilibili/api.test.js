/**
 * Tests for the Hachimi search keyword strategy in BilibiliAPI.
 *
 * The bare keyword "哈基米" surfaced off-topic content (cat vlogs, game
 * clips) and a small repetitive pool. searchHachimiVideos must now query
 * the configured music-focused keywords instead, two distinct ones per
 * call, and merge both result sets before filtering.
 */

const api = require("../../../src/bilibili/api");
const config = require("../../../src/config/config");

function makeVideo(bvid, title, overrides = {}) {
  return {
    bvid,
    aid: undefined,
    title,
    author: "tester",
    mid: 1,
    description: "",
    pic: "",
    duration: 120,
    pubdate: 1700000000,
    view: 50000,
    like: 5000,
    danmaku: 100,
    tag: "哈基米",
    tid: 3,
    url: `https://www.bilibili.com/video/${bvid}`,
    ...overrides,
  };
}

describe("config.bilibili.hachimiSearchKeywords", () => {
  test("defaults to music-focused queries, not the bare meme keyword", () => {
    expect(config.bilibili.hachimiSearchKeywords).toContain("哈基米音乐");
    expect(config.bilibili.hachimiSearchKeywords).not.toContain("哈基米");
    expect(config.bilibili.hachimiSearchKeywords.length).toBeGreaterThan(1);
  });

  test("covers the newer 大狗叫 / 叮咚鸡 memes", () => {
    const joined = config.bilibili.hachimiSearchKeywords.join(" ");
    expect(joined).toContain("大狗叫");
    expect(joined).toContain("叮咚鸡");
  });
});

describe("config.bilibili.hachimiRelevanceTerms", () => {
  test("gates on every tracked meme family, bare terms only", () => {
    expect(config.bilibili.hachimiRelevanceTerms).toEqual(
      expect.arrayContaining(["哈基米", "大狗叫", "叮咚鸡"]),
    );
  });
});

describe("sampleSearchKeywords", () => {
  test("returns distinct keywords from the configured list", () => {
    for (let i = 0; i < 20; i++) {
      const sampled = api.sampleSearchKeywords(2);
      expect(sampled).toHaveLength(2);
      expect(new Set(sampled).size).toBe(2);
      for (const keyword of sampled) {
        expect(config.bilibili.hachimiSearchKeywords).toContain(keyword);
      }
    }
  });

  test("caps at the configured list length and floors at 1", () => {
    const all = api.sampleSearchKeywords(100);
    expect(all).toHaveLength(config.bilibili.hachimiSearchKeywords.length);
    expect(api.sampleSearchKeywords(0)).toHaveLength(1);
  });
});

describe("searchHachimiVideos keyword usage", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("queries two configured keywords and merges both batches", async () => {
    const queried = [];
    jest.spyOn(api, "fetchRawCandidates").mockImplementation(async (keyword) => {
      queried.push(keyword);
      return queried.length === 1
        ? [makeVideo("BV1aaa", "哈基米音乐 remix A")]
        : [makeVideo("BV1bbb", "哈基米 音mad B")];
    });

    const { results } = await api.searchHachimiVideos(5, null);

    expect(queried).toHaveLength(2);
    expect(new Set(queried).size).toBe(2);
    for (const keyword of queried) {
      expect(config.bilibili.hachimiSearchKeywords).toContain(keyword);
      expect(keyword).not.toBe("哈基米");
    }
    expect(results.map((v) => v.bvid).sort()).toEqual(["BV1aaa", "BV1bbb"]);
  });

  test("reports search_failed when both batches come back empty", async () => {
    jest.spyOn(api, "fetchRawCandidates").mockResolvedValue([]);
    const res = await api.searchHachimiVideos(5, null);
    expect(res.results).toEqual([]);
    expect(res.failReason).toBe("search_failed");
  });
});
