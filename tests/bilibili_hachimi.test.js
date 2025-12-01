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
});
