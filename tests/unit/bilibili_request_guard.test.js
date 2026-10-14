jest.mock("../../src/services/logger_service", () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

const logger = require("../../src/services/logger_service");
const config = require("../../src/config/config");
const guard = require("../../src/bilibili/request_guard");

describe("Bilibili request guard", () => {
  let gap;
  let jitter;
  let cooldown;

  beforeEach(() => {
    jest.clearAllMocks();
    gap = config.bilibili.minRequestGapMs;
    jitter = config.bilibili.requestJitterMs;
    cooldown = config.bilibili.riskControlCooldownMs;
    guard._reset();
  });

  afterEach(() => {
    config.bilibili.minRequestGapMs = gap;
    config.bilibili.requestJitterMs = jitter;
    config.bilibili.riskControlCooldownMs = cooldown;
    jest.useRealTimers();
  });

  test("spaces concurrent requests by the minimum gap instead of bursting", async () => {
    jest.useFakeTimers({ now: 0 });
    config.bilibili.minRequestGapMs = 1000;
    config.bilibili.requestJitterMs = 0;

    const done = [];
    [1, 2, 3].forEach((n) => guard.acquireSlot("view").then(() => done.push([n, Date.now()])));

    await jest.advanceTimersByTimeAsync(2500);

    expect(done).toEqual([[1, 0], [2, 1000], [3, 2000]]);
  });

  test("recognises Bilibili 412s from the native API and from yt-dlp", () => {
    expect(guard.isRiskControlRejection(new Error("Bilibili API request failed: HTTP 412"))).toBe(true);
    expect(guard.isRiskControlRejection(new Error("Unable to download webpage: HTTP Error 412: Precondition Failed"))).toBe(true);
    expect(guard.isRiskControlRejection(new Error("HTTP 404"))).toBe(false);
  });

  test("a 412 starts a cooldown that expires", () => {
    jest.useFakeTimers({ now: 0 });
    config.bilibili.riskControlCooldownMs = 60000;

    guard.noteRiskControl("test");
    expect(guard.isCoolingDown()).toBe(true);

    jest.setSystemTime(60001);
    expect(guard.isCoolingDown()).toBe(false);
  });

  test("logs the previous day's request count when the day rolls over", () => {
    jest.useFakeTimers({ now: new Date("2026-10-14T23:59:00Z") });
    guard._reset();
    guard.countRequest("search");
    guard.countRequest("view");
    guard.countRequest("view");

    jest.setSystemTime(new Date("2026-10-15T00:01:00Z"));
    guard.countRequest("view");

    expect(logger.info).toHaveBeenCalledWith("Bilibili daily request count", {
      day: "2026-10-14",
      total: 3,
      byKind: { search: 1, view: 2 },
    });
  });
});
