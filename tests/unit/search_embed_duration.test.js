jest.mock("discord.js", () => {
  class MockEmbedBuilder {
    constructor() {
      this.data = { fields: [] };
    }

    setTitle(title) {
      this.data.title = title;
      return this;
    }

    setDescription(description) {
      this.data.description = description;
      return this;
    }

    setColor(color) {
      this.data.color = color;
      return this;
    }

    setTimestamp() {
      this.data.timestamp = true;
      return this;
    }

    addFields(...fields) {
      this.data.fields.push(...fields);
      return this;
    }

    setFooter(footer) {
      this.data.footer = footer;
      return this;
    }
  }

  return { EmbedBuilder: MockEmbedBuilder };
});

const EmbedBuilders = require("../../src/ui/embeds");
const CLOCK_ICON = String.fromCodePoint(0x23f1, 0xfe0f);

function fieldValues(embed) {
  return embed.data.fields.map(field => field.value);
}

describe("search embed duration display", () => {
  test("single-platform search results show inline hh:mm:ss durations without clock icon", () => {
    const embed = EmbedBuilders.createSearchResultsEmbed(
      [
        { title: "Short", uploader: "A", duration: 65, viewCount: 123 },
        { title: "Long", uploader: "B", duration: "1:02:03", viewCount: 456 },
      ],
      "hachimi",
    );

    const values = fieldValues(embed);
    expect(values.join("\n")).not.toContain(CLOCK_ICON);
    expect(values[0]).toContain("`00:01:05`");
    expect(values[1]).toContain("`01:02:03`");
  });

  test("dual-platform search results show inline hh:mm:ss durations without clock icon", () => {
    const embed = EmbedBuilders.createDualSearchEmbed(
      [{ title: "Bili", uploader: "A", duration: "2:03" }],
      [{ title: "YT", uploader: "B", duration: 3723 }],
      "hachimi",
    );

    const values = fieldValues(embed);
    expect(values.join("\n")).not.toContain(CLOCK_ICON);
    expect(values).toContain("by A | `00:02:03`");
    expect(values).toContain("by B | `01:02:03`");
  });
});
