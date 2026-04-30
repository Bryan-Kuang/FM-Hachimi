import { randomUUID } from 'crypto';
import type { LogContext } from '../services/logger_service';

interface Logger {
  info(msg: string, ctx?: LogContext): void;
  warn(msg: string, ctx?: LogContext): void;
  error(msg: string, ctx?: LogContext): void;
  debug(msg: string, ctx?: LogContext): void;
}

interface TraceContext extends Record<string, unknown> {
  traceId?: string;
}

interface EnrichedLogger {
  info(msg: string, ctx?: LogContext): void;
  warn(msg: string, ctx?: LogContext): void;
  error(msg: string, ctx?: LogContext): void;
  debug(msg: string, ctx?: LogContext): void;
  traceId: string;
  context: TraceContext;
}

export function newTraceId(): string {
  return randomUUID().slice(0, 8);
}

export function withTrace(logger: Logger, context?: TraceContext): EnrichedLogger {
  const traceId = context?.traceId || newTraceId();
  const enriched: TraceContext = { traceId, ...context };
  return {
    info: (msg, ctx) => logger.info(msg, { ...enriched, ...ctx }),
    warn: (msg, ctx) => logger.warn(msg, { ...enriched, ...ctx }),
    error: (msg, ctx) => logger.error(msg, { ...enriched, ...ctx }),
    debug: (msg, ctx) => logger.debug(msg, { ...enriched, ...ctx }),
    traceId,
    context: enriched,
  };
}
