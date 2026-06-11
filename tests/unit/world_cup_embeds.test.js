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
function lastURL() {
  const builder = EmbedBuilder.mock.results[EmbedBuilder.mock.results.length - 1].value;
  return builder.setURL.mock.calls[0]?.[0];
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
    link: "https://www.espn.com/soccer/match/_/gameId/m1",
    ...overrides,
  };
}

beforeEach(() => jest.clearAllMocks());

describe("buildEventEmbed", () => {
  test("kickoff names both teams", () => {
    WcEmbeds.buildEventEmbed(mk({ status: "live" }), "kickoff");
    expect(lastTitle()).toContain("kickoff");
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
    expect(lastTitle()).toContain("full-time");
    expect(lastTitle()).toContain("2–1");
  });

  test.each(["kickoff", "goal", "fulltime"])("%s title says it's the World Cup", (kind) => {
    WcEmbeds.buildEventEmbed(mk(), kind, "home");
    expect(lastTitle()).toContain("World Cup");
  });

  test("links to the live match page (title URL + description link)", () => {
    WcEmbeds.buildEventEmbed(mk(), "goal", "away");
    expect(lastURL()).toBe("https://www.espn.com/soccer/match/_/gameId/m1");
    expect(lastDescription()).toContain("(https://www.espn.com/soccer/match/_/gameId/m1)");
  });

  test("omits the link gracefully when the match has none", () => {
    WcEmbeds.buildEventEmbed(mk({ link: "" }), "kickoff");
    expect(lastURL()).toBeUndefined();
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
    expect(desc).toContain("](https://www.espn.com/soccer/match/_/gameId/m1)"); // live link per line
  });

  test("empty list renders a friendly message", () => {
    WcEmbeds.buildMatchListEmbed([], "Today");
    expect(lastDescription()).toMatch(/no matches/i);
  });
});
