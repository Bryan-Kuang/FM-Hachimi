/**
 * Unit test: Now-playing embed progress bar format.
 *
 * Pins the bar style at `█` (filled) / `░` (empty) with a fixed 20-char width —
 * matches the README's documented style and replaces the short-lived `━>━`
 * variant that shipped briefly before issue #12's fix PR.
 *
 * The global `tests/setup.js` mock of discord.js's EmbedBuilder lacks
 * `setFooter` / `setURL`, so we override it here with a field-capturing stub.
 */

jest.mock("discord.js", () => {
  class FakeEmbedBuilder {
    constructor() {
      this.fields = [];
      this.description = "";
    }
    setTitle() { return this; }
    setDescription(text) { 
      this.description = text; 
      return this; 
    }
    setURL() { return this; }
    setThumbnail() { return this; }
    setColor() { return this; }
    setTimestamp() { return this; }
    setFooter() { return this; }
    setAuthor() { return this; }
    setImage() { return this; }
    addFields(...args) {
      const flat = args.flat();
      this.fields.push(...flat);
      return this;
    }
  }
  return { EmbedBuilder: FakeEmbedBuilder };
});

const EmbedBuilders = require("../../src/ui/embeds");

function getProgressField(embed) {
  return { value: embed.description || "" };
}

describe("createNowPlayingEmbed progress bar", () => {
  const baseTrack = {
    title: "song",
    url: "https://example.com",
    uploader: "u",
    duration: 100,
    thumbnail: null,
  };

  test("uses █ and ░ characters — not ━ or >", () => {
    const embed = EmbedBuilders.createNowPlayingEmbed(baseTrack, {
      currentTime: 50,
      requestedBy: "tester",
    });
    const field = getProgressField(embed);
    expect(field).toBeDefined();
    expect(field.value).toMatch(/[█░]/);
    expect(field.value).not.toMatch(/━/);
    // Allow `>` in other parts of the embed, but not in the bar segment.
    const bar = field.value.match(/([█░]{20})/)?.[1];
    expect(bar).toBeDefined();
    expect(bar).not.toContain(">");
  });

  test("bar is exactly 20 characters wide", () => {
    const embed = EmbedBuilders.createNowPlayingEmbed(baseTrack, {
      currentTime: 0,
      requestedBy: "tester",
    });
    const field = getProgressField(embed);
    const bar = field.value.match(/([█░]{20})/)?.[1];
    expect(bar).toBeDefined();
    expect(bar.length).toBe(20);
  });

  test("50% progress → 10 filled, 10 empty", () => {
    const embed = EmbedBuilders.createNowPlayingEmbed(baseTrack, {
      currentTime: 50,
      requestedBy: "tester",
    });
    const field = getProgressField(embed);
    const bar = field.value.match(/([█░]{20})/)?.[1];
    const filled = (bar.match(/█/g) || []).length;
    const empty = (bar.match(/░/g) || []).length;
    expect(filled).toBe(10);
    expect(empty).toBe(10);
  });

  test("0% progress → all empty", () => {
    const embed = EmbedBuilders.createNowPlayingEmbed(baseTrack, {
      currentTime: 0,
      requestedBy: "tester",
    });
    const field = getProgressField(embed);
    const bar = field.value.match(/([█░]{20})/)?.[1];
    expect(bar).toBe("░".repeat(20));
  });

  test("100% progress → all filled", () => {
    const embed = EmbedBuilders.createNowPlayingEmbed(baseTrack, {
      currentTime: 100,
      requestedBy: "tester",
    });
    const field = getProgressField(embed);
    const bar = field.value.match(/([█░]{20})/)?.[1];
    expect(bar).toBe("█".repeat(20));
  });

  test("no percentage text in progress line (per product decision)", () => {
    const embed = EmbedBuilders.createNowPlayingEmbed(baseTrack, {
      currentTime: 42,
      requestedBy: "tester",
    });
    const field = getProgressField(embed);
    expect(field.value).not.toMatch(/\d+%/);
  });
});
