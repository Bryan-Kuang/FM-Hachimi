const logger = require("../../src/services/logger_service");

jest.mock("../../src/services/logger_service", () => ({
  info:  jest.fn(),
  error: jest.fn(),
  warn:  jest.fn(),
  debug: jest.fn(),
}));

const { GatewayWatchdog } = require("../../src/bot/gateway_watchdog");

describe("GatewayWatchdog", () => {
  let now;
  let onStuck;
  let watchdog;

  const advance = (ms) => { now += ms; };

  const make = (overrides = {}) =>
    new GatewayWatchdog({
      stuckTimeoutMs: 120000,
      logIntervalMs:  15000,
      now:            () => now,
      onStuck,
      ...overrides,
    });

  beforeEach(() => {
    now     = 1_000_000;
    onStuck = jest.fn();
    jest.clearAllMocks();
    watchdog = make();
  });

  it("starts healthy and reports no outage", () => {
    expect(watchdog.isHealthy()).toBe(true);
    expect(watchdog.unhealthyForMs()).toBe(0);
  });

  it("goes unhealthy on the first shard error and tracks the outage age", () => {
    watchdog.recordFailure(0, "Unexpected server response: 503");
    expect(watchdog.isHealthy()).toBe(false);

    advance(5000);
    expect(watchdog.unhealthyForMs()).toBe(5000);
  });

  it("keeps the original outage start across repeated failures", () => {
    watchdog.recordFailure(0, "503");
    advance(30000);
    watchdog.recordFailure(0, "503");
    advance(30000);

    expect(watchdog.unhealthyForMs()).toBe(60000);
  });

  it("recovers when the shard reconnects", () => {
    watchdog.recordFailure(0, "503");
    advance(10000);
    watchdog.recordRecovery("resumed");

    expect(watchdog.isHealthy()).toBe(true);
    expect(watchdog.unhealthyForMs()).toBe(0);
    expect(onStuck).not.toHaveBeenCalled();
  });

  it("does not escalate while the outage is inside the timeout", () => {
    watchdog.recordFailure(0, "503");
    advance(119000);
    watchdog.check();

    expect(onStuck).not.toHaveBeenCalled();
  });

  it("escalates once the outage exceeds the timeout", () => {
    watchdog.recordFailure(0, "503");
    advance(120001);
    watchdog.check();

    expect(onStuck).toHaveBeenCalledTimes(1);
    expect(onStuck).toHaveBeenCalledWith(
      expect.objectContaining({ unhealthyForMs: 120001, lastError: "503" })
    );
  });

  it("escalates only once per outage", () => {
    watchdog.recordFailure(0, "503");
    advance(200000);
    watchdog.check();
    watchdog.check();
    watchdog.recordFailure(0, "503");
    watchdog.check();

    expect(onStuck).toHaveBeenCalledTimes(1);
  });

  it("re-arms escalation after a recovery", () => {
    watchdog.recordFailure(0, "503");
    advance(200000);
    watchdog.check();
    watchdog.recordRecovery("ready");

    watchdog.recordFailure(0, "503");
    advance(200000);
    watchdog.check();

    expect(onStuck).toHaveBeenCalledTimes(2);
  });

  it("never escalates when the timeout is disabled", () => {
    watchdog = make({ stuckTimeoutMs: 0 });
    watchdog.recordFailure(0, "503");
    advance(10 * 60 * 1000);
    watchdog.check();

    expect(onStuck).not.toHaveBeenCalled();
  });

  it("logs the first failure immediately and then throttles", () => {
    watchdog.recordFailure(0, "503");
    expect(logger.warn).toHaveBeenCalledTimes(1);

    advance(1000);
    watchdog.recordFailure(0, "503");
    advance(1000);
    watchdog.recordFailure(0, "503");
    expect(logger.warn).toHaveBeenCalledTimes(1);

    advance(15000);
    watchdog.recordFailure(0, "503");
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({ suppressed: 2 })
    );
  });

  it("reports the failure count for the current outage on recovery", () => {
    watchdog.recordFailure(0, "503");
    watchdog.recordFailure(0, "503");
    advance(4000);
    watchdog.recordRecovery("resumed");

    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("recovered"),
      expect.objectContaining({ failures: 2, outageMs: 4000 })
    );
  });
});
