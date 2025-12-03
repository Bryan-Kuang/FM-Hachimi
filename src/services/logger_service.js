const winston = require('winston')
const fs = require('fs')
const path = require('path')

const logsDir = path.join(process.cwd(), 'logs')
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true })
}

function dateString() {
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

const errorFile = path.join(logsDir, `error-${dateString()}.log`)
const appFile = path.join(logsDir, `app-${dateString()}.log`)

const formatLine = winston.format.printf(({ timestamp, level, message, context }) => {
  const ctx = context ? JSON.stringify(context) : ''
  const lvl = String(level || '').toUpperCase()
  return `[${timestamp}][${lvl}][${message}][${ctx}]`
})

const baseFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  formatLine
)

const logLevel = process.env.LOG_LEVEL || 'info'

const logger = winston.createLogger({
  level: logLevel,
  format: baseFormat,
  transports: [
    new winston.transports.File({ filename: errorFile, level: 'error', maxsize: 10 * 1024 * 1024, maxFiles: 5, tailable: true }),
    new winston.transports.File({ filename: appFile, level: logLevel, maxsize: 10 * 1024 * 1024, maxFiles: 5, tailable: true }),
    new winston.transports.Console({ level: logLevel })
  ]
})

function log(level, message, context) {
  const fn = logger[level]
  if (typeof fn === 'function') {
    fn.call(logger, message, context)
  } else {
    logger.log({ level, message, context })
  }
}

module.exports = {
  debug: (message, context) => log('debug', message, context),
  info: (message, context) => log('info', message, context),
  warn: (message, context) => log('warn', message, context),
  error: (message, context) => log('error', message, context),
  fatal: (message, context) => log('error', message, context)
}
