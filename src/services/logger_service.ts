import winston from 'winston';
import fs from 'fs';
import path from 'path';

const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

function dateString(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

const errorFile = path.join(logsDir, `error-${dateString()}.log`);
const appFile = path.join(logsDir, `app-${dateString()}.log`);

const formatLine = winston.format.printf(({ timestamp, level, message, context }) => {
  const ctx = context ? JSON.stringify(context) : '';
  const lvl = String(level || '').toUpperCase();
  return `[${timestamp}][${lvl}][${message}][${ctx}]`;
});

const baseFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  formatLine
);

const logLevel = process.env.LOG_LEVEL || 'info';
const logToFile = process.env.LOG_TO_FILE !== 'false';

const transports: winston.transport[] = [new winston.transports.Console({ level: logLevel })];
if (logToFile) {
  transports.unshift(
    new winston.transports.File({ filename: errorFile, level: 'error', maxsize: 10 * 1024 * 1024, maxFiles: 5, tailable: true })
  );
  transports.unshift(
    new winston.transports.File({ filename: appFile, level: logLevel, maxsize: 10 * 1024 * 1024, maxFiles: 5, tailable: true })
  );
}

const logger = winston.createLogger({
  level: logLevel,
  format: baseFormat,
  transports
});

type LogContext = Record<string, unknown>;

function log(level: string, message: string, context?: LogContext): void {
  logger.log({ level, message, context });
}

export function debug(message: string, context?: LogContext): void { log('debug', message, context); }
export function info(message: string, context?: LogContext): void  { log('info',  message, context); }
export function warn(message: string, context?: LogContext): void  { log('warn',  message, context); }
export function error(message: string, context?: LogContext): void { log('error', message, context); }
export function fatal(message: string, context?: LogContext): void { log('error', message, context); }
