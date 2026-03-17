const BilibiliAPI = require("../src/utils/bilibiliApi");

describe("BilibiliAPI Hachimi Logic", () => {
  // Mock Data
  const mockVideos = [
    { bvid: "1", title: "High Views, Low Likes", view: 20000, like: 100 }, // Like rate 0.5% (Fail by rate, Pass by Views > 10k) -> PASS
    { bvid: "2", title: "Low Views, High Likes", view: 100, like: 6 }, // Like rate 6% (Pass by rate) -> PASS
    { bvid: "3", title: "Low Views, Low Likes", view: 100, like: 1 }, // Like rate 1% (Fail) -> FAIL
    { bvid: "4", title: "Exact Boundary Views", view: 10001, like: 0 }, // Views > 10k -> PASS
    { bvid: "5", title: "Exact Boundary Rate", view: 100, like: 5 }, // Like rate 5% (Fail, needs > 5%) -> FAIL
    { bvid: "6", title: "Exact Boundary Rate 2", view: 100, like: 6 }, // Like rate 6% -> PASS
  ];

  test("filterQualityVideos should correctly filter based on new criteria", () => {
    const qualified = BilibiliAPI.filterQualityVideos(mockVideos);

    // Criteria: (Like Rate > 5%) OR (Views > 10,000)

    // Expected Results:
    // 1. 20000 views > 10000 -> PASS
    // 2. 6/100 = 6% > 5% -> PASS
    // 3. 1/100 = 1% < 5%, 100 < 10000 -> FAIL
    // 4. 10001 > 10000 -> PASS
    // 5. 5/100 = 5% (Not > 5%) -> FAIL (Assuming > 0.05 strictly)
    // 6. 6/100 = 6% -> PASS

    expect(qualified.length).toBe(4);

    const ids = qualified.map((v) => v.bvid);
    expect(ids).toContain("1");
    expect(ids).toContain("2");
    expect(ids).toContain("4");
    expect(ids).toContain("6");
    expect(ids).not.toContain("3");
    expect(ids).not.toContain("5");
  });

  test("filterQualityVideos should calculate like rate correctly", () => {
    const video = [{ view: 1000, like: 60 }]; // 6%
    const result = BilibiliAPI.filterQualityVideos(video);
    expect(result[0].likeRate).toBe(0.06);
  });

  test("filterQualityVideos should handle zero views safely", () => {
    const video = [{ view: 0, like: 0 }];
    const result = BilibiliAPI.filterQualityVideos(video);
    expect(result.length).toBe(0);
  });

  test("config has hachimiAllowedTids with music and guichu partitions", () => {
    const config = require("../src/config/config");
    const tids = config.bilibili.hachimiAllowedTids;
    expect(Array.isArray(tids)).toBe(true);
    // 音乐区 main and sub-partitions
    expect(tids).toContain(3);    // 音乐区 main
    expect(tids).toContain(28);   // 原创音乐
    expect(tids).toContain(30);   // VOCALOID
    // 鬼畜区 main and sub-partitions
    expect(tids).toContain(119);  // 鬼畜区 main
    expect(tids).toContain(22);   // 鬼畜调教
    expect(tids).toContain(26);   // 音MAD
    // Should NOT contain unrelated partitions
    expect(tids).not.toContain(1);   // 动画
    expect(tids).not.toContain(17);  // 游戏
  });

  test("parseVideoInfo captures tid from typeid field", () => {
    const raw = {
      bvid: "BV1test",
      aid: 123,
      title: "Test Video",
      author: "Author",
      mid: 456,
      description: "desc",
      pic: "https://img.example.com/pic.jpg",
      duration: "03:45",
      pubdate: 1700000000,
      play: 5000,
      like: 300,
      danmaku: 50,
      tag: "鬼畜",
      typeid: 22,
    };
    const result = BilibiliAPI.parseVideoInfo(raw);
    expect(result.tid).toBe(22);
  });

  test("parseVideoInfo defaults tid to 0 when typeid is missing", () => {
    const raw = {
      bvid: "BV2test",
      title: "No Type Video",
      play: 1000,
      like: 50,
    };
    const result = BilibiliAPI.parseVideoInfo(raw);
    expect(result.tid).toBe(0);
  });

  test("processCandidates excludes videos not in 鬼畜/音乐 partitions", () => {
    const rawList = [
      { bvid: "keep1", tid: 22, view: 20000, like: 1000, url: "https://bilibili.com/video/BVkeep1" },
      { bvid: "keep2", tid: 3,  view: 50000, like: 3000, url: "https://bilibili.com/video/BVkeep2" },
      { bvid: "drop1", tid: 1,  view: 20000, like: 1000, url: "https://bilibili.com/video/BVdrop1" },
      { bvid: "drop2", tid: 17, view: 20000, like: 1000, url: "https://bilibili.com/video/BVdrop2" },
    ];
    const { results } = BilibiliAPI.processCandidates(rawList, null, 10);
    const ids = results.map(v => v.bvid);
    expect(ids).toContain("keep1");
    expect(ids).toContain("keep2");
    expect(ids).not.toContain("drop1");
    expect(ids).not.toContain("drop2");
  });

  describe("filterByPartition", () => {
    const videos = [
      { bvid: "a", tid: 22 },   // 鬼畜调教 → allowed
      { bvid: "b", tid: 3 },    // 音乐区 → allowed
      { bvid: "c", tid: 119 },  // 鬼畜区 main → allowed
      { bvid: "d", tid: 1 },    // 动画区 → not allowed
      { bvid: "e", tid: 17 },   // 游戏区 → not allowed
      { bvid: "f", tid: 0 },    // unknown → not allowed
    ];

    test("keeps only videos with allowed tids", () => {
      const allowed = [3, 22, 26, 28, 29, 30, 31, 59, 119, 126, 130, 193, 216, 243];
      const result = BilibiliAPI.filterByPartition(videos, allowed);
      expect(result.map(v => v.bvid)).toEqual(["a", "b", "c"]);
    });

    test("returns empty array when no videos match", () => {
      const result = BilibiliAPI.filterByPartition(videos, [999]);
      expect(result).toEqual([]);
    });

    test("returns empty array for empty input", () => {
      const result = BilibiliAPI.filterByPartition([], [3, 22]);
      expect(result).toEqual([]);
    });

    test("returns empty array when allowedTids is not an array", () => {
      const videos = [{ bvid: "x", tid: 22 }];
      expect(BilibiliAPI.filterByPartition(videos, null)).toEqual([]);
      expect(BilibiliAPI.filterByPartition(videos, undefined)).toEqual([]);
    });
  });
});
