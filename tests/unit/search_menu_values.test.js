jest.mock("discord.js", () => {
  class MockStringSelectMenuBuilder {
    constructor() {
      this.data = { options: [] };
    }

    setCustomId(id) {
      this.data.custom_id = id;
      return this;
    }

    setPlaceholder(placeholder) {
      this.data.placeholder = placeholder;
      return this;
    }

    setMinValues(value) {
      this.data.min_values = value;
      return this;
    }

    setMaxValues(value) {
      this.data.max_values = value;
      return this;
    }

    addOptions(option) {
      this.data.options.push(option);
      return this;
    }
  }

  class MockActionRowBuilder {
    constructor() {
      this.components = [];
    }

    addComponents(component) {
      this.components.push(component);
      return this;
    }
  }

  return {
    ActionRowBuilder: MockActionRowBuilder,
    ButtonBuilder: jest.fn(),
    ButtonStyle: { Primary: 1, Secondary: 2, Success: 3, Danger: 4, Link: 5 },
    StringSelectMenuBuilder: MockStringSelectMenuBuilder,
  };
});

const ButtonBuilders = require("../../src/ui/buttons");

function selectOptions(row) {
  return row.components[0].data.options;
}

describe("search result select menu values", () => {
  test("/play dual search menu uses direct Bilibili and YouTube identities", () => {
    const row = ButtonBuilders.createDualSearchMenu(
      [
        { title: "Bili BV", bvid: "BV1abc", uploader: "A" },
        { title: "Bili av", id: 12345, uploader: "B" },
      ],
      [{ title: "YT", id: "dQw4w9WgXcQ", uploader: "C" }],
      "hachimi",
    );

    expect(selectOptions(row).map(option => option.value)).toEqual([
      "bili:BV1abc",
      "bili:12345",
      "yt:dQw4w9WgXcQ",
    ]);
  });

  test("/search menu uses direct Bilibili identities when platform is bilibili", () => {
    const row = ButtonBuilders.createSearchResultsMenu(
      [
        { title: "Bili BV", bvid: "BV1search", uploader: "A" },
        { title: "Bili URL", url: "https://www.bilibili.com/video/av2468", uploader: "B" },
      ],
      "hachimi",
      "bilibili",
    );

    expect(selectOptions(row).map(option => option.value)).toEqual([
      "bili:BV1search",
      "bili:av2468",
    ]);
  });

  test("/search menu uses direct YouTube identities when platform is youtube", () => {
    const row = ButtonBuilders.createSearchResultsMenu(
      [
        { title: "YT id", id: "dQw4w9WgXcQ", uploader: "A" },
        { title: "YT url", url: "https://www.youtube.com/watch?v=abcdefghijk", uploader: "B" },
      ],
      "hachimi",
      "youtube",
    );

    expect(selectOptions(row).map(option => option.value)).toEqual([
      "yt:dQw4w9WgXcQ",
      "yt:abcdefghijk",
    ]);
  });

  test("falls back to legacy index value when a direct identity is unavailable", () => {
    const row = ButtonBuilders.createDualSearchMenu(
      [{ title: "No ID", uploader: "A" }],
      [{ title: "Also no ID", uploader: "B" }],
      "hachimi",
    );

    expect(selectOptions(row).map(option => option.value)).toEqual(["bili_0", "yt_0"]);
  });
});
