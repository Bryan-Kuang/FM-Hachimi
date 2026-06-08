/**
 * WorldCupSource unit tests — ESPN scoreboard JSON parsing.
 */

jest.mock("../../src/services/logger_service", () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

const WorldCupSource = require("../../src/world_cup/source");

// A trimmed ESPN scoreboard payload shaped exactly like the live endpoint.
function espnPayload(events) {
  return { data: { events } };
}

function event({ id, date, state, detail, clock, home, away, homeScore, awayScore, group, venue }) {
  return {
    id,
    date,
    status: { displayClock: clock, type: { state, detail, description: detail } },
    competitions: [
      {
        venue: { fullName: venue },
        notes: group ? [{ headline: group }] : [],
        competitors: [
          { homeAway: "home", score: String(homeScore), team: { displayName: home, abbreviation: home.slice(0, 3).toUpperCase() } },
          { homeAway: "away", score: String(awayScore), team: { displayName: away, abbreviation: away.slice(0, 3).toUpperCase() } },
        ],
      },
    ],
  };
}

function makeSource(httpGet) {
  return new WorldCupSource({ baseUrl: "https://espn.test/scoreboard", timeoutMs: 5000, httpGet });
}

describe("WorldCupSource", () => {
  test("parses scheduled/live/final events into normalized matches", async () => {
    const httpGet = jest.fn().mockResolvedValue(
      espnPayload([
        event({ id: "1", date: "2026-06-11T19:00Z", state: "pre", detail: "Scheduled", clock: "0'", home: "Mexico", away: "South Africa", homeScore: 0, awayScore: 0, group: "Group A", venue: "Estadio Banorte" }),
        event({ id: "2", date: "2026-06-11T22:00Z", state: "in", detail: "67'", clock: "67'", home: "Argentina", away: "Saudi Arabia", homeScore: 2, awayScore: 1, group: "Group C", venue: "MetLife" }),
        event({ id: "3", date: "2026-06-11T16:00Z", state: "post", detail: "FT", clock: "90'", home: "France", away: "Australia", homeScore: 2, awayScore: 1, group: "Group D", venue: "SoFi" }),
      ])
    );
    const matches = await makeSource(httpGet).fetchMatchesForDate("20260611");

    expect(matches).toHaveLength(3);
    expect(matches[0]).toMatchObject({
      id: "1",
      status: "scheduled",
      home: { name: "Mexico", abbrev: "MEX", score: 0 },
      away: { name: "South Africa", abbrev: "SOU", score: 0 },
      group: "Group A",
      venue: "Estadio Banorte",
    });
    expect(matches[1]).toMatchObject({ id: "2", status: "live", clock: "67'", home: { score: 2 }, away: { score: 1 } });
    expect(matches[2]).toMatchObject({ id: "3", status: "final", home: { score: 2 }, away: { score: 1 } });
  });

  test("passes the date param + timeout to the HTTP getter", async () => {
    const httpGet = jest.fn().mockResolvedValue(espnPayload([]));
    await makeSource(httpGet).fetchMatchesForDate("20260615");

    expect(httpGet).toHaveBeenCalledWith(
      "https://espn.test/scoreboard",
      expect.objectContaining({ params: { dates: "20260615" }, timeout: 5000 })
    );
  });

  test("returns [] when the source lists no events", async () => {
    const httpGet = jest.fn().mockResolvedValue(espnPayload([]));
    expect(await makeSource(httpGet).fetchMatchesForDate("20260611")).toEqual([]);
  });

  test("skips malformed events but keeps valid ones", async () => {
    const httpGet = jest.fn().mockResolvedValue(
      espnPayload([
        { id: "bad", competitions: [{ competitors: [] }] }, // no home/away
        event({ id: "ok", date: "2026-06-11T19:00Z", state: "pre", detail: "Scheduled", clock: "0'", home: "Brazil", away: "Serbia", homeScore: 0, awayScore: 0, group: "Group G", venue: "Stadium" }),
      ])
    );
    const matches = await makeSource(httpGet).fetchMatchesForDate("20260611");
    expect(matches).toHaveLength(1);
    expect(matches[0].id).toBe("ok");
  });

  test("throws on HTTP failure so callers can detect a degraded source", async () => {
    const httpGet = jest.fn().mockRejectedValue(new Error("ETIMEDOUT"));
    await expect(makeSource(httpGet).fetchMatchesForDate("20260611")).rejects.toThrow("ETIMEDOUT");
  });
});
