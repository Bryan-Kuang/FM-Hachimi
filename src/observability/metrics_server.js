/**
 * Minimal HTTP server exposing the metrics registry as JSON.
 * Binds to localhost by default — debug/ops use only, not internet-exposed.
 *
 * Env:
 *   METRICS_ENABLED=true           — opt-in (default: false)
 *   METRICS_PORT=9090              — listen port
 *   METRICS_HOST=127.0.0.1         — bind host
 */

const http = require("http");
const { registry } = require("./metrics");
const logger = require("../services/logger_service");

function createMetricsServer({ port, host } = {}) {
  const listenPort = Number(port ?? process.env.METRICS_PORT ?? 9090);
  const listenHost = host ?? process.env.METRICS_HOST ?? "127.0.0.1";

  const server = http.createServer((req, res) => {
    if (req.url === "/metrics" && req.method === "GET") {
      const body = JSON.stringify(registry.snapshot(), null, 2);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(body);
      return;
    }
    if (req.url === "/healthz" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("ok");
      return;
    }
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
  });

  return {
    start() {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(listenPort, listenHost, () => {
          server.off("error", reject);
          logger.info("Metrics server listening", { host: listenHost, port: listenPort });
          resolve(server);
        });
      });
    },
    stop() {
      return new Promise((resolve) => server.close(() => resolve()));
    },
    get server() {
      return server;
    },
  };
}

function startMetricsServerFromEnv() {
  if (process.env.METRICS_ENABLED !== "true") return null;
  const server = createMetricsServer();
  server.start().catch((err) => {
    logger.warn("Metrics server failed to start", { error: err.message });
  });
  return server;
}

module.exports = {
  createMetricsServer,
  startMetricsServerFromEnv,
};
