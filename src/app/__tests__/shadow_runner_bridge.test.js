const bridge = require("../shadow_runner_bridge");

function mkLogger() {
  return { warn: jest.fn(), info: jest.fn(), debug: jest.fn() };
}

describe("shadow_runner_bridge — safety guarantees", () => {
  test("returns disabled stub when SHADOW_MODE_ENABLED is unset", () => {
    const logger = mkLogger();
    const r = bridge.createShadowRunner("g1", logger, {});
    expect(r.enabled).toBe(false);
    expect(r.dispatch({ type: "PLAY_REQUESTED" })).toEqual({ kind: "idle" });
    expect(r.getState()).toEqual({ kind: "idle" });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test("returns disabled stub when SHADOW_MODE_ENABLED=false", () => {
    const r = bridge.createShadowRunner("g1", mkLogger(), { SHADOW_MODE_ENABLED: "false" });
    expect(r.enabled).toBe(false);
  });

  test("returns disabled stub + warn when enabled but compiled output missing", () => {
    // Simulate the uncompiled case by injecting a loader that returns null —
    // equivalent to `dist/` not existing in production.
    const logger = mkLogger();
    const nullLoader = () => null;
    const r = bridge.createShadowRunner("g1", logger, { SHADOW_MODE_ENABLED: "true" }, nullLoader);
    expect(r.enabled).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("compiled"));
  });

  test("enables and wraps real runner when loader returns a valid module", () => {
    const logger = mkLogger();
    const fakeMod = {
      createShadowRunner: (_g, _l, _env) => ({
        enabled: true,
        dispatch: () => ({ kind: "idle" }),
        compareOutcome: () => {},
        reset: () => {},
        getState: () => ({ kind: "idle" }),
      }),
    };
    const r = bridge.createShadowRunner("g1", logger, { SHADOW_MODE_ENABLED: "true" }, () => fakeMod);
    expect(r.enabled).toBe(true);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test("disabled stub methods never throw", () => {
    const r = bridge.createDisabledRunner();
    expect(() => r.dispatch({ type: "X" })).not.toThrow();
    expect(() => r.compareOutcome({ kind: "idle" })).not.toThrow();
    expect(() => r.reset()).not.toThrow();
    expect(() => r.getState()).not.toThrow();
    expect(() => r.setGuildId("g1")).not.toThrow();
  });

  test("disabled stub exposes setGuildId so callers never need to branch", () => {
    // audio_player.js calls _shadow.setGuildId() unconditionally on voice
    // join. If the stub were missing this method the legacy path would
    // throw TypeError — exactly what the bridge's defense-in-depth story
    // exists to prevent.
    const r = bridge.createDisabledRunner();
    expect(typeof r.setGuildId).toBe("function");
  });

  test("wrapSafe proxies setGuildId to the underlying runner", () => {
    const setGuildId = jest.fn();
    const fakeMod = {
      createShadowRunner: () => ({
        enabled: true,
        dispatch: () => ({ kind: "idle" }),
        compareOutcome: () => {},
        reset: () => {},
        getState: () => ({ kind: "idle" }),
        setGuildId,
      }),
    };
    const r = bridge.createShadowRunner("unknown", mkLogger(), { SHADOW_MODE_ENABLED: "true" }, () => fakeMod);
    r.setGuildId("guild-xyz");
    expect(setGuildId).toHaveBeenCalledWith("guild-xyz");
  });

  test("compareOutcome is a no-op on the disabled stub", () => {
    const logger = mkLogger();
    const r = bridge.createShadowRunner("g1", logger, {});
    r.compareOutcome({ kind: "retry" });
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
