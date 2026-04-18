const { newTraceId, withTrace } = require("../trace");

describe("newTraceId", () => {
  test("returns an 8-char string", () => {
    const id = newTraceId();
    expect(typeof id).toBe("string");
    expect(id).toHaveLength(8);
  });

  test("returns distinct IDs across calls", () => {
    const ids = new Set(Array.from({ length: 100 }, () => newTraceId()));
    expect(ids.size).toBeGreaterThan(95);
  });
});

describe("withTrace", () => {
  let mockLogger;

  beforeEach(() => {
    mockLogger = {
      info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
    };
  });

  test("generates a traceId when none is passed", () => {
    const l = withTrace(mockLogger, { guildId: "g1" });
    expect(l.traceId).toHaveLength(8);
    expect(l.context).toMatchObject({ traceId: l.traceId, guildId: "g1" });
  });

  test("reuses an existing traceId from context", () => {
    const l = withTrace(mockLogger, { traceId: "existing1", guildId: "g1" });
    expect(l.traceId).toBe("existing1");
  });

  test("enriches every log call with traceId and base context", () => {
    const l = withTrace(mockLogger, { guildId: "g1", module: "play" });

    l.info("started", { extra: "data" });

    expect(mockLogger.info).toHaveBeenCalledWith("started", {
      traceId: l.traceId,
      guildId: "g1",
      module: "play",
      extra: "data",
    });
  });

  test("call-site ctx overrides base context on conflicts", () => {
    const l = withTrace(mockLogger, { guildId: "g1" });
    l.info("msg", { guildId: "g2" });
    expect(mockLogger.info).toHaveBeenCalledWith("msg", expect.objectContaining({ guildId: "g2" }));
  });

  test("error/warn/debug all enrich consistently", () => {
    const l = withTrace(mockLogger, { guildId: "g1" });
    l.warn("w");
    l.error("e");
    l.debug("d");

    for (const fn of [mockLogger.warn, mockLogger.error, mockLogger.debug]) {
      expect(fn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ traceId: l.traceId, guildId: "g1" }));
    }
  });
});
