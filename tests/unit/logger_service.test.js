const logger = require('../../src/logger_service')

test('logger_service error does not throw', () => {
  expect(() => logger.error('test error', { a: 1 })).not.toThrow()
})

test('logger_service info does not throw', () => {
  expect(() => logger.info('test info', { b: 2 })).not.toThrow()
})

