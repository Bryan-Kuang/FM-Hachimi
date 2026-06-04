jest.mock("../../src/services/logger_service", () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

const ExpiringCache = require("../../src/utils/expiring_cache");

describe("ExpiringCache", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  test("stores and retrieves values", () => {
    const cache = new ExpiringCache(1000, 10, { cleanupIntervalMs: 0 });
    cache.set("a", { title: "A" });
    expect(cache.get("a")).toEqual({ title: "A" });
    expect(cache.has("a")).toBe(true);
    expect(cache.size).toBe(1);
    cache.dispose();
  });

  test("returns null and evicts on read after TTL expiry", () => {
    jest.useFakeTimers();
    const cache = new ExpiringCache(1000, 10, { cleanupIntervalMs: 0 });
    cache.set("a", 1);
    jest.advanceTimersByTime(1500);
    expect(cache.get("a")).toBeNull();
    expect(cache.size).toBe(0); // lazily evicted on read
    cache.dispose();
  });

  test("ageMs reports age for live entries and null for expired", () => {
    jest.useFakeTimers();
    const cache = new ExpiringCache(1000, 10, { cleanupIntervalMs: 0 });
    cache.set("a", 1);
    jest.advanceTimersByTime(400);
    expect(cache.ageMs("a")).toBe(400);
    jest.advanceTimersByTime(1000);
    expect(cache.ageMs("a")).toBeNull();
    expect(cache.ageMs("missing")).toBeNull();
    cache.dispose();
  });

  test("cleanup enforces max size by evicting oldest entries", () => {
    jest.useFakeTimers();
    const cache = new ExpiringCache(60_000, 2, { cleanupIntervalMs: 0 });
    cache.set("a", 1);
    jest.advanceTimersByTime(10);
    cache.set("b", 2);
    jest.advanceTimersByTime(10);
    cache.set("c", 3);
    const removed = cache.cleanup();
    expect(removed).toBe(1);
    expect(cache.get("a")).toBeNull(); // oldest evicted
    expect(cache.get("b")).toBe(2);
    expect(cache.get("c")).toBe(3);
    cache.dispose();
  });

  test("delete and clear remove entries", () => {
    const cache = new ExpiringCache(1000, 10, { cleanupIntervalMs: 0 });
    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.delete("a")).toBe(true);
    expect(cache.get("a")).toBeNull();
    cache.clear();
    expect(cache.size).toBe(0);
    cache.dispose();
  });

  test("dispose stops the cleanup timer", () => {
    jest.useFakeTimers();
    const clearSpy = jest.spyOn(global, "clearInterval");
    const cache = new ExpiringCache(1000, 10, { cleanupIntervalMs: 5000 });
    cache.dispose();
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });
});
