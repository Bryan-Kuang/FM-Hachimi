const { validateEnv } = require("../env_validator");

function baseEnv(overrides = {}) {
  return { DISCORD_TOKEN: "token", CLIENT_ID: "client", ...overrides };
}

describe("validateEnv — required vars", () => {
  test("passes with DISCORD_TOKEN and CLIENT_ID set", () => {
    const result = validateEnv(baseEnv());
    expect(result.ok).toBe(true);
  });

  test("fails when DISCORD_TOKEN is missing", () => {
    const result = validateEnv({ CLIENT_ID: "x" });
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([expect.stringContaining("DISCORD_TOKEN")]));
  });

  test("fails when CLIENT_ID is missing", () => {
    const result = validateEnv({ DISCORD_TOKEN: "x" });
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([expect.stringContaining("CLIENT_ID")]));
  });

  test("treats empty string as missing", () => {
    const result = validateEnv({ DISCORD_TOKEN: "", CLIENT_ID: "   " });
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(2);
  });
});

describe("validateEnv — integer-valued env vars", () => {
  test("accepts unset optional ints", () => {
    const result = validateEnv(baseEnv());
    expect(result.ok).toBe(true);
  });

  test("rejects non-numeric int var", () => {
    const result = validateEnv(baseEnv({ MAX_QUEUE_SIZE: "abc" }));
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain("MAX_QUEUE_SIZE");
  });

  test("rejects zero or negative int var", () => {
    const zero = validateEnv(baseEnv({ VOICE_CONNECTION_TIMEOUT_MS: "0" }));
    expect(zero.ok).toBe(false);
    const neg = validateEnv(baseEnv({ VOICE_CONNECTION_TIMEOUT_MS: "-5" }));
    expect(neg.ok).toBe(false);
  });

  test("accepts valid positive int", () => {
    const result = validateEnv(baseEnv({ VOICE_CONNECTION_TIMEOUT_MS: "20000" }));
    expect(result.ok).toBe(true);
  });
});

describe("validateEnv — like-rate-threshold", () => {
  test("accepts value in [0, 1]", () => {
    expect(validateEnv(baseEnv({ BILIBILI_LIKE_RATE_THRESHOLD: "0.05" })).ok).toBe(true);
    expect(validateEnv(baseEnv({ BILIBILI_LIKE_RATE_THRESHOLD: "0" })).ok).toBe(true);
    expect(validateEnv(baseEnv({ BILIBILI_LIKE_RATE_THRESHOLD: "1" })).ok).toBe(true);
  });

  test("rejects value outside [0, 1]", () => {
    expect(validateEnv(baseEnv({ BILIBILI_LIKE_RATE_THRESHOLD: "1.5" })).ok).toBe(false);
    expect(validateEnv(baseEnv({ BILIBILI_LIKE_RATE_THRESHOLD: "-0.1" })).ok).toBe(false);
  });

  test("rejects non-numeric", () => {
    expect(validateEnv(baseEnv({ BILIBILI_LIKE_RATE_THRESHOLD: "high" })).ok).toBe(false);
  });
});

describe("validateEnv — LOG_LEVEL warnings", () => {
  test("known levels produce no warning", () => {
    const result = validateEnv(baseEnv({ LOG_LEVEL: "debug" }));
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  test("unknown level produces a warning but still ok", () => {
    const result = validateEnv(baseEnv({ LOG_LEVEL: "loud" }));
    expect(result.ok).toBe(true);
    expect(result.warnings[0]).toContain("LOG_LEVEL");
  });
});
