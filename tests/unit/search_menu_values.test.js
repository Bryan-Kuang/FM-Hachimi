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

  const BLANK = "​"; // zero-width space

  test("single platform lays out rows of two and pages 10 at a time", () => {
    const session = makeSession(manyEntries(25));

    // 25 entries at 2 × 5 per page = 3 pages.
    expect(SearchResultsView.totalPagesFor(session)).toBe(3);

    const first = SearchResultsView.buildSearchResultsMessage(TOKEN, session);
    const embed = first.embeds[0].toJSON();
    // 5 rows × (left + right + invisible row-closer) = 15 fields.
    expect(embed.fields).toHaveLength(15);
    expect(embed.fields.every(field => field.inline)).toBe(true);
    expect(embed.fields[0].name).toBe("1. Video 0");
    expect(embed.fields[1].name).toBe("2. Video 1");
    expect(embed.fields[2].name).toBe(BLANK);
    expect(embed.fields[3].name).toBe("3. Video 2");

    const [prev, indicator, next] = pageButtons(first);
    expect(prev.custom_id).toBe(`search_page_${TOKEN}_prev`);
    expect(prev.disabled).toBe(true);
    expect(indicator.disabled).toBe(true);
    expect(next.disabled).toBe(false);

    session.currentPage = 3;
    const last = SearchResultsView.buildSearchResultsMessage(TOKEN, session);
    const lastEmbed = last.embeds[0].toJSON();
    // Page 3 holds entries 21–25: rows (21,22), (23,24), (25,blank) = 9 fields.
    expect(lastEmbed.fields[0].name).toBe("21. Video 20");
    expect(lastEmbed.fields).toHaveLength(9);
    // 25 is odd, so the last row's right slot is an invisible placeholder.
    expect(lastEmbed.fields[6].name).toBe("25. Video 24");
    expect(lastEmbed.fields[7].name).toBe(BLANK);
    const [lastPrev, , lastNext] = pageButtons(last);
    expect(lastPrev.disabled).toBe(false);
    expect(lastNext.disabled).toBe(true);

    // Select menu always covers all 25 results regardless of the page.
    expect(selectMenu(last).options).toHaveLength(25);
  });

  test("dual platform pairs each row and pages each column independently", () => {
    const session = makeSession(
      [...manyEntries(13, "bilibili"), ...manyEntries(12, "youtube", 13)],
      "dual",
    );

    // 13 Bilibili at 5 per column page = 3 pages (YouTube: 12 → 3 pages too).
    expect(SearchResultsView.totalPagesFor(session)).toBe(3);

    const first = SearchResultsView.buildSearchResultsMessage(TOKEN, session);
    const embed = first.embeds[0].toJSON();
    expect(embed.fields).toHaveLength(15);
    expect(embed.fields[0].name).toBe("B1. Video 0");
    expect(embed.fields[1].name).toBe("Y1. Video 0");
    expect(embed.fields[2].name).toBe(BLANK);
    expect(embed.fields[3].name).toBe("B2. Video 1");
    expect(embed.fields[4].name).toBe("Y2. Video 1");

    session.currentPage = 3;
    const last = SearchResultsView.buildSearchResultsMessage(TOKEN, session).embeds[0].toJSON();
    expect(last.fields[0].name).toBe("B11. Video 10");
    expect(last.fields[1].name).toBe("Y11. Video 10");
    // Row 3 has B13 but no Y13 — the right slot is an invisible placeholder.
    expect(last.fields[6].name).toBe("B13. Video 12");
    expect(last.fields[7].name).toBe(BLANK);
    expect(last.fields).toHaveLength(9);
  });

  test("an exhausted dual column renders placeholders instead of empty fields", () => {
    const session = makeSession(
      [...manyEntries(8, "bilibili"), ...manyEntries(3, "youtube", 8)],
      "dual",
    );
    session.currentPage = 2;

    const embed = SearchResultsView.buildSearchResultsMessage(TOKEN, session).embeds[0].toJSON();
    expect(embed.fields[0].name).toBe("B6. Video 5");
    expect(embed.fields[1].name).toBe(BLANK);
    expect(embed.fields[1].value).toBe(BLANK);
  });

  test("single page hides the page buttons row", () => {
    const message = SearchResultsView.buildSearchResultsMessage(TOKEN, makeSession(manyEntries(10)));
    expect(pageButtons(message)).toBeNull();
  });
});
