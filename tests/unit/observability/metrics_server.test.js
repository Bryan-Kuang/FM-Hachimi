jest.mock("../../../src/services/logger_service", () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const http = require("http");
const { createMetricsServer } = require("../../../src/observability/metrics_server");
const { counter, histogram, reset } = require("../../../src/observability/metrics");

function fetchJson(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port, path }, (res) => {
      let body = "";
      res.on("data", (c) => { body += c; });
      res.on("end", () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    req.on("error", reject);
  });
}

describe("metrics HTTP server", () => {
  let server;

  beforeEach(() => { reset(); });

  afterEach(async () => {
    if (server) await server.stop();
    server = null;
  });

  test("GET /metrics returns snapshot JSON", async () => {
    counter("play_requested_total").inc({ guild: "g1" });
    histogram("dur_ms").observe(500);

    server = createMetricsServer({ port: 0, host: "127.0.0.1" });
    await server.start();
    const port = server.server.address().port;

    const res = await fetchJson(port, "/metrics");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");
    const parsed = JSON.parse(res.body);
    expect(parsed.counters.play_requested_total.values).toHaveProperty("guild=g1", 1);
    expect(parsed.histograms.dur_ms.values._.count).toBe(1);
  });

  test("GET /healthz returns 200 ok", async () => {
    server = createMetricsServer({ port: 0, host: "127.0.0.1" });
    await server.start();
    const port = server.server.address().port;

    const res = await fetchJson(port, "/healthz");

    expect(res.status).toBe(200);
    expect(res.body).toBe("ok");
  });

  test("unknown routes return 404", async () => {
    server = createMetricsServer({ port: 0, host: "127.0.0.1" });
    await server.start();
    const port = server.server.address().port;

    const res = await fetchJson(port, "/nonexistent");

    expect(res.status).toBe(404);
  });

  test("server rejects start on port already in use", async () => {
    server = createMetricsServer({ port: 0, host: "127.0.0.1" });
    await server.start();
    const port = server.server.address().port;

    const conflict = createMetricsServer({ port, host: "127.0.0.1" });
    await expect(conflict.start()).rejects.toThrow();
  });
});
