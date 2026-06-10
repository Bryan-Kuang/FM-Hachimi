// Uses the real discord.js builders (overriding the global mock in
// tests/setup.js) so toJSON() also exercises payload validation.
jest.unmock("discord.js");

const SearchResultsView = require("../../src/ui/search_results_view");

const TOKEN = "aabbccddee";

function makeSession(entries, mode = "bilibili") {
  return { keyword: "hachimi", mode, entries, currentPage: 1 };
}

function selectMenu(message) {
  const row = message.components
    .map(component => component.toJSON())
    .find(component => component.components[0].type === 3);
  return row.components[0];
}

function pageButtons(message) {
  const row = message.components
    .map(component => component.toJSON())
    .find(component => component.components[0].type === 2);
  return row ? row.components : null;
}

describe("search results view select menu values", () => {
  test("dual-platform entries use direct Bilibili and YouTube identities", () => {
    const entries = [
      ...SearchResultsView.createSessionEntries(
        [
          { title: "Bili BV", bvid: "BV1abc", uploader: "A" },
          { title: "Bili av", id: 12345, uploader: "B" },
        ],
        "bilibili",
      ),
      ...SearchResultsView.createSessionEntries(
        [{ title: "YT", id: "dQw4w9WgXcQ", uploader: "C" }],
        "youtube",
        2,
      ),
    ];

    const message = SearchResultsView.buildSearchResultsMessage(TOKEN, makeSession(entries, "dual"));

    expect(selectMenu(message).options.map(option => option.value)).toEqual([
      "bili:BV1abc",
      "bili:12345",
      "yt:dQw4w9WgXcQ",
    ]);
    // Dual-mode labels number each platform column independently.
    expect(selectMenu(message).options.map(option => option.label)).toEqual([
      "B1. Bili BV",
      "B2. Bili av",
      "Y1. YT",
    ]);
    expect(selectMenu(message).custom_id).toBe(`search_select_v2_${TOKEN}`);
  });

  test("Bilibili entries resolve identities from bvid and URL", () => {
    const entries = SearchResultsView.createSessionEntries(
      [
        { title: "Bili BV", bvid: "BV1search", uploader: "A" },
        { title: "Bili URL", url: "https://www.bilibili.com/video/av2468", uploader: "B" },
      ],
      "bilibili",
    );

    const message = SearchResultsView.buildSearchResultsMessage(TOKEN, makeSession(entries));

    expect(selectMenu(message).options.map(option => option.value)).toEqual([
      "bili:BV1search",
      "bili:av2468",
    ]);
    expect(selectMenu(message).options.map(option => option.label)).toEqual([
      "1. Bili BV",
      "2. Bili URL",
    ]);
  });

  test("YouTube entries resolve identities from id and URL", () => {
    const entries = SearchResultsView.createSessionEntries(
      [
        { title: "YT id", id: "dQw4w9WgXcQ", uploader: "A" },
        { title: "YT url", url: "https://www.youtube.com/watch?v=abcdefghijk", uploader: "B" },
      ],
      "youtube",
    );

    const message = SearchResultsView.buildSearchResultsMessage(TOKEN, makeSession(entries, "youtube"));

    expect(selectMenu(message).options.map(option => option.value)).toEqual([
      "yt:dQw4w9WgXcQ",
      "yt:abcdefghijk",
    ]);
  });

  test("falls back to session index values when a direct identity is unavailable", () => {
    const entries = [
      ...SearchResultsView.createSessionEntries([{ title: "No ID", uploader: "A" }], "bilibili"),
      ...SearchResultsView.createSessionEntries([{ title: "Also no ID", uploader: "B" }], "youtube", 1),
    ];

    const message = SearchResultsView.buildSearchResultsMessage(TOKEN, makeSession(entries, "dual"));

    expect(selectMenu(message).options.map(option => option.value)).toEqual(["idx_0", "idx_1"]);
  });

  test("duplicate identities are deduplicated with index fallback values", () => {
    const entries = SearchResultsView.createSessionEntries(
      [
        { title: "First copy", bvid: "BV1dup", uploader: "A" },
        { title: "Second copy", bvid: "BV1dup", uploader: "A" },
      ],
      "bilibili",
    );

    const message = SearchResultsView.buildSearchResultsMessage(TOKEN, makeSession(entries));

    expect(selectMenu(message).options.map(option => option.value)).toEqual([
      "bili:BV1dup",
      "idx_1",
    ]);
  });
});

describe("search results view pagination", () => {
  function manyEntries(count, platform = "bilibili", startIndex = 0) {
    return SearchResultsView.createSessionEntries(
      Array.from({ length: count }, (_, index) => ({
        title: `Video ${index}`,
        [platform === "bilibili" ? "bvid" : "id"]:
          platform === "bilibili" ? `BV${index}` : `AAAAAAAAA${String(index).padStart(2, "0")}`.slice(-11),
        uploader: "Uploader",
        duration: 60 + index,
      })),
      platform,
      startIndex,
    );
  }

  test("single platform shows two columns of 5 and pages 10 at a time", () => {
    const session = makeSession(manyEntries(25));

    // 25 entries at 2 × 5 per page = 3 pages.
    expect(SearchResultsView.totalPagesFor(session)).toBe(3);

    const first = SearchResultsView.buildSearchResultsMessage(TOKEN, session);
    const embed = first.embeds[0].toJSON();
    expect(embed.fields).toHaveLength(2);
    expect(embed.fields[0].inline).toBe(true);
    expect(embed.fields[1].inline).toBe(true);
    expect(embed.fields[0].value).toContain("**1.**");
    expect(embed.fields[0].value).toContain("**5.**");
    expect(embed.fields[1].value).toContain("**6.**");
    expect(embed.fields[1].value).toContain("**10.**");

    const [prev, indicator, next] = pageButtons(first);
    expect(prev.custom_id).toBe(`search_page_${TOKEN}_prev`);
    expect(prev.disabled).toBe(true);
    expect(indicator.disabled).toBe(true);
    expect(next.disabled).toBe(false);

    session.currentPage = 3;
    const last = SearchResultsView.buildSearchResultsMessage(TOKEN, session);
    const lastEmbed = last.embeds[0].toJSON();
    expect(lastEmbed.fields[0].value).toContain("**21.**");
    expect(lastEmbed.fields[0].value).toContain("**25.**");
    const [lastPrev, , lastNext] = pageButtons(last);
    expect(lastPrev.disabled).toBe(false);
    expect(lastNext.disabled).toBe(true);

    // Select menu always covers all 25 results regardless of the page.
    expect(selectMenu(last).options).toHaveLength(25);
  });

  test("dual platform pages each column independently", () => {
    const session = makeSession(
      [...manyEntries(13, "bilibili"), ...manyEntries(12, "youtube", 13)],
      "dual",
    );

    // 13 Bilibili at 5 per column page = 3 pages (YouTube: 12 → 3 pages too).
    expect(SearchResultsView.totalPagesFor(session)).toBe(3);

    const first = SearchResultsView.buildSearchResultsMessage(TOKEN, session);
    const embed = first.embeds[0].toJSON();
    expect(embed.fields.map(field => field.name)).toEqual(["Bilibili", "YouTube"]);
    expect(embed.fields[0].value).toContain("**B1.**");
    expect(embed.fields[0].value).toContain("**B5.**");
    expect(embed.fields[1].value).toContain("**Y1.**");
    expect(embed.fields[1].value).toContain("**Y5.**");

    session.currentPage = 3;
    const last = SearchResultsView.buildSearchResultsMessage(TOKEN, session).embeds[0].toJSON();
    expect(last.fields[0].value).toContain("**B11.**");
    expect(last.fields[0].value).toContain("**B13.**");
    expect(last.fields[1].value).toContain("**Y11.**");
    expect(last.fields[1].value).toContain("**Y12.**");
  });

  test("an exhausted dual column renders a placeholder instead of an empty field", () => {
    const session = makeSession(
      [...manyEntries(8, "bilibili"), ...manyEntries(3, "youtube", 8)],
      "dual",
    );
    session.currentPage = 2;

    const embed = SearchResultsView.buildSearchResultsMessage(TOKEN, session).embeds[0].toJSON();
    expect(embed.fields[0].value).toContain("**B6.**");
    expect(embed.fields[1].value).toBe("​"); // zero-width space placeholder
  });

  test("single page hides the page buttons row", () => {
    const message = SearchResultsView.buildSearchResultsMessage(TOKEN, makeSession(manyEntries(10)));
    expect(pageButtons(message)).toBeNull();
  });
});
