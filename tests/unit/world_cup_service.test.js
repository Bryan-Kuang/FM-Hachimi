/**
 * WorldCupService unit tests — window gating, live-event diffing, restart
 * safety, subscription persistence, and the on-demand backup path.
 */

jest.mock("../../src/services/logger_service", () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

// Render is the embeds module's concern (covered by world_cup_embeds.test.js).
// Here we only care WHICH events the diff produced, so return a tagged object.
jest.mock("../../src/world_cup/embeds", () => ({
  buildMatchListEmbed: jest.fn(() => ({ kind: "list" })),
  buildEventEmbed: jest.fn((match, kind) => ({ kind, matchId: match.id })),
  matchLine: jest.fn(() => ""),
}));

const fs = require("fs");
const os = require("os");
const path = require("path");
const WorldCupService = require("../../src/world_cup/world_cup_service");

function isoDate(offsetDays) {
  return new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
}

function makeConfig(dir, { start, end, timezone } = {}) {
  return {
    enabled: true,
    startDate: start || isoDate(-1),
    endDate: end || isoDate(2),
    livePollMs: 60000,
    idlePollMs: 600000,
    dataDir: dir,
    timezone: timezone || "UTC",
  };
}

function mk(status, h, a) {
  return {
    id: "m1",
    utcDate: new Date().toISOString(), // kicking off "now" → always on today's day key
    status,
    detail: "",
    clock: status === "live" ? "45'" : "",
    home: { name: "Mexico", abbrev: "MEX", score: h },
    away: { name: "South Africa", abbrev: "RSA", score: a },
    group: "Group A",
    venue: "Estadio Banorte",
  };
}

function makeSource(initial) {
  return { fetchMatchesForDate: jest.fn().mockResolvedValue(initial ?? []) };
}

function makeClient() {
  const send = jest.fn().mockResolvedValue(undefined);
  const channel = { isTextBased: () => true, send };
  const client = { channels: { fetch: jest.fn().mockResolvedValue(channel) } };
  return { client, send };
}

// Each send carries one tagged embed: { kind, matchId }.
function eventsOf(send) {
  return send.mock.calls.map((c) => c[0].embeds[0]);
}

// Build a started+stopped service (loads files, sets client, no live timer).
function startService(config, source, client) {
  const service = new WorldCupService(config, source);
  service.initialize(client);
  service.stop(); // cancel the background timer; tests call pollOnce() directly
  return service;
}

let dir;
beforeEach(() => {
  jest.clearAllMocks();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "worldcup-"));
});
afterEach(() => {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe("window gate", () => {
  test("isActive is true inside the window and false outside", () => {
    expect(new WorldCupService(makeConfig(dir), makeSource()).isActive()).toBe(true);
    const past = new WorldCupService(makeConfig(dir, { start: "2020-06-01", end: "2020-07-01" }), makeSource());
    expect(past.isActive()).toBe(false);
  });

  test("pollOnce is a no-op (no fetch) outside the window", async () => {
    const source = makeSource([mk("live", 1, 0)]);
    const { client } = makeClient();
    const service = startService(makeConfig(dir, { start: "2020-06-01", end: "2020-07-01" }), source, client);
    await service.pollOnce();
    expect(source.fetchMatchesForDate).not.toHaveBeenCalled();
  });
});

describe("live-event diffing", () => {
  test("emits exactly one kickoff, one goal, one full-time across a match", async () => {
    const source = makeSource();
    const { client, send } = makeClient();
    const service = startService(makeConfig(dir), source, client);
    service.setSubscription("g1", "c1");

    source.fetchMatchesForDate.mockResolvedValue([mk("scheduled", 0, 0)]);
    await service.pollOnce(); // seed silently
    expect(send).not.toHaveBeenCalled();

    source.fetchMatchesForDate.mockResolvedValue([mk("live", 0, 0)]);
    await service.pollOnce(); // kickoff

    source.fetchMatchesForDate.mockResolvedValue([mk("live", 1, 0)]);
    await service.pollOnce(); // home goal

    source.fetchMatchesForDate.mockResolvedValue([mk("final", 1, 0)]);
    await service.pollOnce(); // full-time

    const events = eventsOf(send);
    expect(events.filter((e) => e.kind === "kickoff")).toHaveLength(1);
    expect(events.filter((e) => e.kind === "goal")).toHaveLength(1);
    expect(events.filter((e) => e.kind === "fulltime")).toHaveLength(1);
  });

  test("both sides scoring between polls produces two goal messages", async () => {
    const source = makeSource();
    const { client, send } = makeClient();
    const service = startService(makeConfig(dir), source, client);
    service.setSubscription("g1", "c1");

    source.fetchMatchesForDate.mockResolvedValue([mk("live", 0, 0)]);
    await service.pollOnce(); // seed
    source.fetchMatchesForDate.mockResolvedValue([mk("live", 1, 1)]);
    await service.pollOnce(); // a goal for each side in one poll

    expect(eventsOf(send).filter((e) => e.kind === "goal")).toHaveLength(2);
  });

  test("a match first seen already live is seeded silently (no replayed kickoff)", async () => {
    const source = makeSource([mk("live", 1, 0)]);
    const { client, send } = makeClient();
    const service = startService(makeConfig(dir), source, client);
    service.setSubscription("g1", "c1");

    await service.pollOnce();
    expect(send).not.toHaveBeenCalled();
  });

  test("a score correction (decrease) updates state silently, no goal message", async () => {
    const source = makeSource();
    const { client, send } = makeClient();
    const service = startService(makeConfig(dir), source, client);
    service.setSubscription("g1", "c1");

    source.fetchMatchesForDate.mockResolvedValue([mk("live", 2, 0)]);
    await service.pollOnce(); // seed
    source.fetchMatchesForDate.mockResolvedValue([mk("live", 1, 0)]);
    await service.pollOnce(); // correction
    expect(send).not.toHaveBeenCalled();
  });

  test("does not re-post events after a restart (state.json is reloaded)", async () => {
    // Service A drives the match to full-time and persists state.
    const sourceA = makeSource();
    const { client: clientA, send: sendA } = makeClient();
    const serviceA = startService(makeConfig(dir), sourceA, clientA);
    serviceA.setSubscription("g1", "c1");
    sourceA.fetchMatchesForDate.mockResolvedValue([mk("scheduled", 0, 0)]);
    await serviceA.pollOnce();
    sourceA.fetchMatchesForDate.mockResolvedValue([mk("final", 1, 0)]);
    await serviceA.pollOnce();
    expect(eventsOf(sendA).some((e) => e.kind === "fulltime")).toBe(true);

    // Service B restarts against the same dir; the final match is already known.
    const sourceB = makeSource([mk("final", 1, 0)]);
    const { client: clientB, send: sendB } = makeClient();
    const serviceB = startService(makeConfig(dir), sourceB, clientB);
    await serviceB.pollOnce();
    expect(sendB).not.toHaveBeenCalled();
  });
});

describe("subscriptions", () => {
  test("set/get/remove and persistence across a restart", () => {
    const { client } = makeClient();
    const service = startService(makeConfig(dir), makeSource(), client);
    service.setSubscription("g1", "c9");
    expect(service.getSubscription("g1")).toEqual({ channelId: "c9" });

    const reloaded = startService(makeConfig(dir), makeSource(), client);
    expect(reloaded.getSubscription("g1")).toEqual({ channelId: "c9" });

    reloaded.removeSubscription("g1");
    expect(reloaded.getSubscription("g1")).toBeNull();
  });
});

describe("backup path (independent of poller)", () => {
  test("getToday returns matches even when the poller never succeeded; health is unhealthy", async () => {
    const source = makeSource([mk("live", 1, 0)]);
    const service = new WorldCupService(makeConfig(dir), source);

    expect(service.getHealth().healthy).toBe(false);
    const today = await service.getToday();
    expect(today).toHaveLength(1);
    service.stop();
  });

  test("finds a match listed on the source's previous day board (date-boundary regression)", async () => {
    // South Korea–Czechia scenario: kickoff 02:00 UTC Jun 12 sits on ESPN's
    // Jun 11 (US-Eastern) board. Asking for the UTC day 20260612 must still
    // find it by also fetching the adjacent boards and filtering by kickoff.
    const boundaryMatch = { ...mk("live", 1, 0), id: "kor-cze", utcDate: "2026-06-12T02:00:00Z" };
    const source = {
      fetchMatchesForDate: jest.fn((d) => Promise.resolve(d === "20260611" ? [boundaryMatch] : [])),
    };
    const service = new WorldCupService(makeConfig(dir), source);

    const matches = await service.getMatchesForDate("20260612");
    expect(matches).toHaveLength(1);
    expect(matches[0].id).toBe("kor-cze");
    expect(source.fetchMatchesForDate.mock.calls.map((c) => c[0])).toEqual(["20260611", "20260612", "20260613"]);

    // ...and it is NOT listed under the day it does not belong to.
    expect(await service.getMatchesForDate("20260611")).toHaveLength(0);
    service.stop();
  });

  test("day boundaries follow the configured timezone", async () => {
    // 02:00 UTC Jun 12 is 22:00 Jun 11 in Toronto → a "June 11" match there.
    const boundaryMatch = { ...mk("scheduled", 0, 0), id: "kor-cze", utcDate: "2026-06-12T02:00:00Z" };
    const source = makeSource([boundaryMatch]);
    const service = new WorldCupService(makeConfig(dir, { timezone: "America/Toronto" }), source);

    expect(await service.getMatchesForDate("20260611")).toHaveLength(1);
    expect(await service.getMatchesForDate("20260612")).toHaveLength(0);
    service.stop();
  });

  test("the poller window includes yesterday's board (late matches stay diffable)", async () => {
    const source = makeSource([]);
    const { client } = makeClient();
    const service = startService(makeConfig(dir), source, client);

    await service.pollOnce();
    const days = source.fetchMatchesForDate.mock.calls.map((c) => c[0]);
    expect(days).toHaveLength(3);
    expect(new Set(days).size).toBe(3); // yesterday, today, tomorrow
  });

  test("a failing poll records health degradation but commands still work", async () => {
    const source = makeSource();
    source.fetchMatchesForDate.mockRejectedValue(new Error("source down"));
    const { client } = makeClient();
    const service = startService(makeConfig(dir), source, client);

    await service.pollOnce();
    const h = service.getHealth();
    expect(h.healthy).toBe(false);
    expect(h.consecutiveFailures).toBe(1);
    expect(h.lastError).toBe("source down");
  });
});
