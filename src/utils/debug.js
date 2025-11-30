const logger = require('../services/logger_service')

const steps = []
let lastError = null

function trace(step, details = {}) {
  steps.push({ step, time: Date.now(), details })
  logger.debug(`TRACE ${step}`, details)
}

function error(step, err) {
  lastError = { step, name: err?.name, code: err?.code, message: err?.message, stack: err?.stack }
  logger.error(`ERROR ${step}`, { name: lastError.name, code: lastError.code, message: lastError.message })
}

function summary() {
  logger.debug('DEBUG_SUMMARY', { steps, lastError })
}

module.exports = { trace, error, summary }

