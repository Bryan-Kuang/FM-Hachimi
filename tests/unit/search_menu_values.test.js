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
  test("mixed-platform entries use direct identities across Bilibili and YouTube", () => {
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

    const message = SearchResultsView.buildSearchResultsMessage(TOKEN, makeSession(entries, "mixed"));

    expect(selectMenu(message).options.map(option => option.value)).toEqual([
      "bili:BV1abc",
      "bili:12345",
      "yt:dQw4w9WgXcQ",
    ]);
    // Mixed mode numbers plainly across the whole interleaved session.
    expect(selectMenu(message).options.map(option => option.label)).toEqual([
      "1. Bili BV",
      "2. Bili av",
      "3. YT",
    ]);
    // Mixed mode prefixes the description with the platform to disambiguate.
    expect(selectMenu(message).options.map(option => option.description)).toEqual([
      "Bilibili | A | --:--",
      "Bilibili | B | --:--",
      "YouTube | C | --:--",
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

    const message = SearchResultsView.buildSearchResultsMessage(TOKEN, makeSession(entries, "mixed"));

    expect(selectMenu(message).options.map(option => option.value)).toEqual(["idx_0", "idx_1"]);
  });

  test("fallback values are recomputed against the entry's final position, not the creation-time offset", () => {
    // Simulates round-robin interleaving: these entries were created with
    // startIndex offsets that no longer match their position in `entries`
    // once reordered (bili created at 0, yt created at 1, but yt ends up
    // first here).
    const bili = SearchResultsView.createSessionEntries([{ title: "No ID Bili" }], "bilibili", 0);
    const yt = SearchResultsView.createSessionEntries([{ title: "No ID YT" }], "youtube", 1);
    const reordered = [...yt, ...bili]; // yt (created idx_1) now at position 0

    const message = SearchResultsView.buildSearchResultsMessage(TOKEN, makeSession(reordered, "mixed"));

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

    // The select menu is page-aware: page 1 only holds entries 1-10.
    expect(selectMenu(first).options).toHaveLength(10);
    expect(selectMenu(first).options[0].label).toBe("1. Video 0");
    expect(selectMenu(first).options[9].label).toBe("10. Video 9");

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

    // Page 3 only holds the remaining 5 entries (21-25), not all 25.
    expect(selectMenu(last).options).toHaveLength(5);
    expect(selectMenu(last).options[0].label).toBe("21. Video 20");
    expect(selectMenu(last).options[4].label).toBe("25. Video 24");
  });

  test("mixed mode interleaves platforms but still numbers and paginates as one flat list", () => {
    const bili = manyEntries(7, "bilibili");
    const yt = manyEntries(6, "youtube", 7);
    // Simple 2-way interleave for the test fixture (production code uses
    // interleaveRoundRobin from src/search/interleave.ts).
    const interleaved = [];
    for (let i = 0; i < Math.max(bili.length, yt.length); i++) {
      if (bili[i]) interleaved.push(bili[i]);
      if (yt[i]) interleaved.push(yt[i]);
    }
    const session = makeSession(interleaved, "mixed");

    // 13 entries at 2 × 5 per page = 2 pages.
    expect(SearchResultsView.totalPagesFor(session)).toBe(2);

    const first = SearchResultsView.buildSearchResultsMessage(TOKEN, session);
    const embed = first.embeds[0].toJSON();
    expect(embed.fields[0].name).toBe("1. Video 0"); // bili[0]
    expect(embed.fields[1].name).toBe("2. Video 0"); // yt[0]
    expect(embed.fields[2].name).toBe(BLANK);
    expect(embed.fields[3].name).toBe("3. Video 1"); // bili[1]

    expect(selectMenu(first).options).toHaveLength(10);
    expect(selectMenu(first).options[0].description).toBe("Bilibili | Uploader | 00:01:00");
    expect(selectMenu(first).options[1].description).toBe("YouTube | Uploader | 00:01:00");

    session.currentPage = 2;
    const second = SearchResultsView.buildSearchResultsMessage(TOKEN, session);
    // Page 2 holds entries 11-13 only (3 entries, not the full 13).
    expect(selectMenu(second).options).toHaveLength(3);
    expect(selectMenu(second).options[0].label).toBe("11. Video 5");
  });

  test("single page hides the page buttons row", () => {
    const message = SearchResultsView.buildSearchResultsMessage(TOKEN, makeSession(manyEntries(10)));
    expect(pageButtons(message)).toBeNull();
  });
});
