import { Track, type TrackData } from "../track";

function baseData(overrides: Partial<TrackData> = {}): TrackData {
  return {
    platform: "bilibili",
    nativeId: "BV1xx",
    title: "test",
    duration: 180,
    audioUrl: "https://cdn/audio",
    ...overrides,
  };
}

describe("Track construction", () => {
  test("computes id as `${platform}:${nativeId}`", () => {
    const t = new Track(baseData());
    expect(t.id).toBe("bilibili:BV1xx");
  });

  test("freezes instance to prevent mutation", () => {
    const t = new Track(baseData());
    expect(Object.isFrozen(t)).toBe(true);
  });

  test("defaults retryCount and requestedBy", () => {
    const t = new Track(baseData());
    expect(t.retryCount).toBe(0);
    expect(t.requestedBy).toBeNull();
  });

  test("addedAt defaults to now and is preserved through immutable updates", () => {
    const t0 = new Date("2025-01-01T00:00:00Z");
    const t = new Track(baseData(), t0);
    expect(t.addedAt).toBe(t0);
    const t2 = t.withIncrementedRetry();
    expect(t2.addedAt).toBe(t0);
  });
});

describe("Track.isExpired", () => {
  test("returns false when extractedAt is missing", () => {
    const t = new Track(baseData());
    expect(t.isExpired(20 * 60 * 1000)).toBe(false);
  });

  test("returns true when beyond threshold", () => {
    const extractedAt = new Date("2025-01-01T00:00:00Z");
    const now = new Date("2025-01-01T00:21:00Z");
    const t = new Track(baseData({ extractedAt }));
    expect(t.isExpired(20 * 60 * 1000, now)).toBe(true);
  });

  test("returns false at exactly threshold boundary", () => {
    const extractedAt = new Date("2025-01-01T00:00:00Z");
    const now = new Date("2025-01-01T00:20:00Z");
    const t = new Track(baseData({ extractedAt }));
    expect(t.isExpired(20 * 60 * 1000, now)).toBe(false);
  });
});

describe("Track immutable updates", () => {
  test("withRefreshedUrl returns a new instance with new url + extractedAt", () => {
    const t1 = new Track(baseData());
    const refreshedAt = new Date("2025-01-01");
    const t2 = t1.withRefreshedUrl("https://cdn2/audio", refreshedAt);
    expect(t2).not.toBe(t1);
    expect(t2.audioUrl).toBe("https://cdn2/audio");
    expect(t2.extractedAt).toBe(refreshedAt);
    expect(t1.audioUrl).toBe("https://cdn/audio"); // unchanged
  });

  test("withIncrementedRetry increments retryCount", () => {
    const t1 = new Track(baseData());
    const t2 = t1.withIncrementedRetry();
    const t3 = t2.withIncrementedRetry();
    expect(t1.retryCount).toBe(0);
    expect(t2.retryCount).toBe(1);
    expect(t3.retryCount).toBe(2);
  });

  test("withResetRetry resets to 0 and returns same instance when already 0", () => {
    const t1 = new Track(baseData());
    expect(t1.withResetRetry()).toBe(t1);
    const t2 = t1.withIncrementedRetry();
    const t3 = t2.withResetRetry();
    expect(t3.retryCount).toBe(0);
    expect(t3).not.toBe(t2);
  });
});
