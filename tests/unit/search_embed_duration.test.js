// Duration display in the paginated search results embed.
// Uses the real discord.js builders, overriding the global mock in tests/setup.js.
jest.unmock("discord.js");

const SearchResultsView = require("../../src/ui/search_results_view");

const TOKEN = "aabbccddee";

function embedFields(message) {
  return message.embeds[0].toJSON().fields;
}

function optionDescriptions(message) {
  const row = message.components
    .map(component => component.toJSON())
    .find(component => component.components[0].type === 3);
  return row.components[0].options.map(option => option.description);
}

describe("search results view duration display", () => {
  test("columns show inline hh:mm:ss durations from numeric and string inputs", () => {
    const entries = SearchResultsView.createSessionEntries(
      [
        { title: "Short", bvid: "BV1a", uploader: "A", duration: 65, viewCount: 123 },
        { title: "Long", bvid: "BV1b", uploader: "B", duration: "1:02:03", viewCount: 456 },
      ],
      "bilibili",
    );
    const message = SearchResultsView.buildSearchResultsMessage(TOKEN, {
      keyword: "hachimi",
      mode: "bilibili",
      entries,
      currentPage: 1,
    });

    const column = embedFields(message)[0].value;
    expect(column).toContain("`00:01:05`");
    expect(column).toContain("`01:02:03`");
  });

  test("select options show plain durations and unknown durations fall back", () => {
    const entries = SearchResultsView.createSessionEntries(
      [
        { title: "Known", bvid: "BV1a", uploader: "A", duration: "2:03" },
        { title: "Unknown", bvid: "BV1b", uploader: "B" },
      ],
      "bilibili",
    );
    const message = SearchResultsView.buildSearchResultsMessage(TOKEN, {
      keyword: "hachimi",
      mode: "bilibili",
      entries,
      currentPage: 1,
    });

    expect(optionDescriptions(message)).toEqual(["A | 00:02:03", "B | --:--"]);
    expect(embedFields(message)[0].value).toContain("`--:--`");
  });
});
