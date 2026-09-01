const http = require("http");

jest.mock("../../src/services/logger_service", () => ({
  info:  jest.fn(),
  error: jest.fn(),
  warn:  jest.fn(),
  debug: jest.fn(),
}));

const { createMetricsServer } = require("../../src/observability/metrics_server");

function get(port, path) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path }, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, body }));
    }).on("error", reject);
  });
}

async function withServer(readiness, fn) {
  const handle = createMetricsServer({ port: 0, host: "127.0.0.1", readiness });
  const server = await handle.start();
  try {
    await fn(server.address().port);
  } finally {
    await handle.stop();
  }
}

describe("metrics server /readyz", () => {
  it("is ready when the bot is running and the gateway is connected", async () => {
    await withServer(
      () => ({ running: true, botStats: { ready: true, gateway: { connected: true, outageMs: 0 } } }),
      async (port) => {
        const res = await get(port, "/readyz");
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body).ready).toBe(true);
      }
    );
  });

  it("is NOT ready when the gateway is disconnected", async () => {
    // The 2026-09-01 zombie: process alive, bot object present, gateway wedged.
    await withServer(
      () => ({ running: true, botStats: { ready: false, gateway: { connected: false, outageMs: 3_000_000 } } }),
      async (port) => {
        const res = await get(port, "/readyz");
        expect(res.status).toBe(503);
        expect(JSON.parse(res.body).ready).toBe(false);
      }
    );
  });

  it("is NOT ready when the bot is not running", async () => {
    await withServer(
      () => ({ running: false, botStats: null }),
      async (port) => {
        const res = await get(port, "/readyz");
        expect(res.status).toBe(503);
      }
    );
  });

  it("stays ready when no botStats are reported at all", async () => {
    await withServer(
      () => ({ running: true }),
      async (port) => {
        const res = await get(port, "/readyz");
        expect(res.status).toBe(200);
      }
    );
  });
});
