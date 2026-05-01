import * as logger from '../services/logger_service';

type DebugStep = { step: string; time: number; details: Record<string, unknown> };
type DebugError = { step: string; name?: string; code?: string | number; message?: string; stack?: string };

const steps: DebugStep[] = [];
let lastError: DebugError | null = null;

export function trace(step: string, details: Record<string, unknown> = {}): void {
  steps.push({ step, time: Date.now(), details });
  logger.debug(`TRACE ${step}`, details);
}

export function error(step: string, err: Error & { code?: string | number }): void {
  lastError = { step, name: err?.name, code: err?.code, message: err?.message, stack: err?.stack };
  logger.error(`ERROR ${step}`, { name: lastError.name, code: lastError.code, message: lastError.message });
}

export function summary(): void {
  logger.debug('DEBUG_SUMMARY', { steps, lastError });
}

