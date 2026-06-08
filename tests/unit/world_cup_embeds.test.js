/**
 * WorldCup embeds — title/description rendering. Uses the global discord.js mock
 * (tests/setup.js), whose EmbedBuilder records setTitle/setDescription calls.
 */

const WcEmbeds = require("../../src/world_cup/embeds");
const { EmbedBuilder } = require("discord.js");

function lastTitle() {
  const builder = EmbedBuilder.mock.results[EmbedBuilder.mock.results.length - 1].value;
  return builder.setTitle.mock.calls[0]?.[0];
}
function lastDescription() {
  const builder = EmbedBuilder.mock.results[EmbedBuilder.mock.results.length - 1].value;
  return builder.setDescription.mock.calls[0]?.[0];
}

function mk(overrides = {}) {
  return {
    id: "m1",
    utcDate: "2026-06-11T19:00Z",
    status: "live",
    detail: "",
    clock: "67'",
    home: { name: "Argentina", abbrev: "ARG", score: 2 },
    away: { name: "Saudi Arabia", abbrev: "KSA", score: 1 },
    group: "Group C",
    venue: "MetLife",
    ...overrides,
  };
}

beforeEach(() => jest.clearAllMocks());

describe("buildEventEmbed", () => {
  test("kickoff names both teams", () => {
    WcEmbeds.buildEventEmbed(mk({ status: "live" }), "kickoff");
    expect(lastTitle()).toContain("Kickoff");
    expect(lastTitle()).toContain("Argentina");
    expect(lastTitle()).toContain("Saudi Arabia");
  });

  test("goal names the scoring side and shows the score", () => {
    WcEmbeds.buildEventEmbed(mk(), "goal", "away");
    expect(lastTitle()).toContain("GOAL");
    expect(lastTitle()).toContain("Saudi Arabia"); // away scored
    expect(lastTitle()).toContain("2–1");
  });

  test("full-time shows the final score", () => {
    WcEmbeds.buildEventEmbed(mk({ status: "final" }), "fulltime");
    expect(lastTitle()).toContain("Full-time");
    expect(lastTitle()).toContain("2–1");
  });
});

describe("buildMatchListEmbed", () => {
  test("renders a line per match with live/FT/kickoff markers", () => {
    WcEmbeds.buildMatchListEmbed(
      [
        mk({ id: "a", status: "live", clock: "67'" }),
        mk({ id: "b", status: "final", utcDate: "2026-06-11T16:00Z" }),
        mk({ id: "c", status: "scheduled", utcDate: "2026-06-11T22:00Z" }),
      ],
      "Today"
    );
    const desc = lastDescription();
    expect(desc).toContain("🔴"); // live marker
    expect(desc).toContain("✅ FT"); // final marker
    expect(desc.split("\n")).toHaveLength(3);
  });

  test("empty list renders a friendly message", () => {
    WcEmbeds.buildMatchListEmbed([], "Today");
    expect(lastDescription()).toMatch(/no matches/i);
  });
});
