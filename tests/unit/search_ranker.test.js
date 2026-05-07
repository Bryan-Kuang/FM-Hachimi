const SearchRanker = require("../../src/utils/search_ranker");

describe("SearchRanker", () => {
  test("promotes punctuation-insensitive exact Chinese title matches", () => {
    const results = [
      { title: "哈基米，但是完全不相关", id: "generic" },
      { title: "Random radio mix", id: "off-topic" },
      { title: "【哈基米】无止境电台", id: "target" },
    ];

    const ranked = SearchRanker.rankAndLimitSearchResults(results, "哈基米无止境电台", 5);

    expect(ranked.map(result => result.id)).toEqual(["target", "generic", "off-topic"]);
  });

  test("keeps platform order when relevance score ties", () => {
    const results = [
      { title: "哈基米 remix", id: "first" },
      { title: "哈基米 cover", id: "second" },
    ];

    const ranked = SearchRanker.rankAndLimitSearchResults(results, "哈基米", 5);

    expect(ranked.map(result => result.id)).toEqual(["first", "second"]);
  });

  test("does not hide weak title matches when filling the requested result count", () => {
    const results = [
      { title: "Unrelated 1", id: "first" },
      { title: "哈基米无止境电台", id: "target" },
      { title: "Unrelated 2", id: "second" },
    ];

    const ranked = SearchRanker.rankAndLimitSearchResults(results, "哈基米无止境电台", 3);

    expect(ranked.map(result => result.id)).toEqual(["target", "first", "second"]);
  });

  test("uses title relevance only, not uploader, tag, or description", () => {
    const results = [
      {
        title: "Totally unrelated title",
        uploader: "哈基米无止境电台",
        tag: "哈基米无止境电台",
        description: "哈基米无止境电台",
        id: "metadata-match",
      },
      {
        title: "【哈基米】无止境电台",
        uploader: "Someone else",
        tag: "",
        description: "",
        id: "title-match",
      },
    ];

    const ranked = SearchRanker.rankAndLimitSearchResults(results, "哈基米无止境电台", 2);

    expect(ranked.map(result => result.id)).toEqual(["title-match", "metadata-match"]);
  });
});
