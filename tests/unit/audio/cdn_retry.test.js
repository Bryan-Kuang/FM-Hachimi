/**
 * Unit tests for the pure helpers extracted from audio_player.js.
 *
 * These test the module boundary directly (no AudioPlayer construction)
 * so we can lean on them to freeze the behavior contract even if
 * AudioPlayer gets restructured further.
 *
 * Method-level regression coverage still lives in
 * tests/regression/cdn_retry.test.js — that file verifies the
 * AudioPlayer wiring + _cdnRetryPending flag coordination, which is a
 * different layer.
 */

const {
  isCdnFailure,
  computeCdnBackoffMs,
  sleep,
} = require("../../../src/audio/cdn_retry");

describe("cdn_retry.isCdnFailure", () => {
  describe("retryable (code + pattern match)", () => {
    const retryableCases = [
      [255, "Will reconnect at 123, error=End of file."],
      [255, "Server returned 403 Forbidden"],
      [255, "Server returned 503 Service Unavailable"],
      [255, "Connection reset by peer"],
      [255, "Connection timed out"],
      [255, "I/O error reading from network"],
      [8, "[https @ 0x7a1] HTTP error 403 Forbidden"],
      [8, "Server returned 403 Forbidden (access denied)"],
      [251, "[tls @ 0x7c2] Unknown error\nError opening input: I/O error"],
    ];
    test.each(retryableCases)("code=%i stderr=%j → true", (code, stderr) => {
      expect(isCdnFailure(code, stderr)).toBe(true);
    });
  });

  describe("non-retryable (wrong code or wrong pattern)", () => {
    const nonRetryableCases = [
      // Right pattern, wrong code
      [0, "End of file"],
      [1, "Server returned 403"],
      [137, "Connection reset"],
      // Right code, wrong pattern
      [255, "Invalid data found when processing input"],
      [255, ""],
      [8, "Invalid argument"],
    ];
    test.each(nonRetryableCases)(
      "code=%i stderr=%j → false",
      (code, stderr) => {
        expect(isCdnFailure(code, stderr)).toBe(false);
      },
    );
  });
});

describe("cdn_retry.computeCdnBackoffMs", () => {
  const retryConfig = {
    cdnBackoffBaseMs: 3000,
    cdnBackoffMultiplier: 5,
    cdnBackoffMaxMs: 60000,
  };

  test("returns 0 under NODE_ENV=test regardless of attempt", () => {
    expect(computeCdnBackoffMs(1, retryConfig, { NODE_ENV: "test" })).toBe(0);
    expect(computeCdnBackoffMs(10, retryConfig, { NODE_ENV: "test" })).toBe(0);
  });

  test("attempt=1 returns base delay", () => {
    expect(computeCdnBackoffMs(1, retryConfig, {})).toBe(3000);
  });

  test("attempt=2 multiplies by multiplier", () => {
    expect(computeCdnBackoffMs(2, retryConfig, {})).toBe(15000);
  });

  test("caps at cdnBackoffMaxMs once the exponential blows past it", () => {
    // 3000 * 5^3 = 375000 > 60000 → should be clamped to 60000
    expect(computeCdnBackoffMs(4, retryConfig, {})).toBe(60000);
    expect(computeCdnBackoffMs(99, retryConfig, {})).toBe(60000);
  });

  test("attempt=0 is treated as attempt=1 via Math.max(0, attempt-1)", () => {
    // exp = max(0, -1) = 0 → 3000 * 1 = 3000
    expect(computeCdnBackoffMs(0, retryConfig, {})).toBe(3000);
  });
});

describe("cdn_retry.sleep", () => {
  test("resolves after approximately the requested delay", async () => {
    const start = Date.now();
    await sleep(20);
    const elapsed = Date.now() - start;
    // Generous lower bound for CI jitter; we just want to confirm the
    // timer fired rather than resolving synchronously.
    expect(elapsed).toBeGreaterThanOrEqual(15);
  });

  test("returned promise is thenable", () => {
    const p = sleep(0);
    expect(typeof p.then).toBe("function");
    return p; // actually await it to avoid unhandled timer
  });
});
