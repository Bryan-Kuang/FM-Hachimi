/**
 * Minimal HTTP server exposing the metrics registry as JSON.
 * Binds to localhost by default — debug/ops use only, not internet-exposed.
 *
 * Env:
 *   METRICS_ENABLED=true           — opt-in (default: false)
 *   METRICS_PORT=9090              — listen port
 *   METRICS_HOST=127.0.0.1         — bind host
 */

import http from 'http';
import { registry } from './metrics';
import * as logger from '../services/logger_service';

type ReadinessSnapshot = boolean | {
  running?: boolean;
  [key: string]: unknown;
};

interface ServerOptions {
  port?: number;
  host?: string;
  readiness?: () => ReadinessSnapshot | Promise<ReadinessSnapshot>;
}

interface MetricsServerHandle {
  start(): Promise<http.Server>;
  stop(): Promise<void>;
  readonly server: http.Server;
}

function writeJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function isReadySnapshot(snapshot: ReadinessSnapshot): boolean {
  if (typeof snapshot === 'boolean') return snapshot;
  return snapshot.running !== false;
}

export function createMetricsServer({ port, host, readiness }: ServerOptions = {}): MetricsServerHandle {
  const listenPort = Number(port ?? process.env.METRICS_PORT ?? 9090);
  const listenHost = host ?? process.env.METRICS_HOST ?? '127.0.0.1';

  const server = http.createServer((req, res) => {
    if (req.url === '/metrics' && req.method === 'GET') {
      const body = JSON.stringify(registry.snapshot(), null, 2);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(body);
      return;
    }
    if (req.url === '/healthz' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
      return;
    }
    if (req.url === '/readyz' && req.method === 'GET') {
      if (!readiness) {
        writeJson(res, 200, { ready: true });
        return;
      }

      Promise.resolve()
        .then(() => readiness())
        .then((snapshot) => {
          writeJson(res, isReadySnapshot(snapshot) ? 200 : 503, {
            ready: isReadySnapshot(snapshot),
            status: snapshot,
          });
        })
        .catch((err: Error) => {
          writeJson(res, 503, { ready: false, error: err.message });
        });
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  });

  return {
    start(): Promise<http.Server> {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(listenPort, listenHost, () => {
          server.off('error', reject);
          logger.info('Metrics server listening', { host: listenHost, port: listenPort });
          resolve(server);
        });
      });
    },
    stop(): Promise<void> {
      return new Promise((resolve) => server.close(() => resolve()));
    },
    get server(): http.Server { return server; },
  };
}

export function startMetricsServerFromEnv(
  readiness?: ServerOptions['readiness'],
): MetricsServerHandle | null {
  if (process.env.METRICS_ENABLED !== 'true') return null;
  const srv = createMetricsServer({ readiness });
  srv.start().catch((err: Error) => {
    logger.warn('Metrics server failed to start', { error: err.message });
  });
  return srv;
}
