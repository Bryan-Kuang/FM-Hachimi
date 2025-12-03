#!/usr/bin/env node

const config = require('../../src/config/config')

function ok(message) {
  console.log(message)
  process.exit(0)
}

function fail(message) {
  console.error(message)
  process.exit(1)
}

try {
  if (!config.discord || !config.discord.token) {
    fail('Discord token missing')
  }
  if (!config.logging || !config.logging.level) {
    fail('Logging config invalid')
  }
  ok('Healthcheck passed')
} catch (e) {
  fail(`Healthcheck error: ${e.message}`)
}

