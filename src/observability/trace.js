/**
 * Trace ID utility.
 * Assigns a short UUID per Discord Interaction so a single /play command's
 * full journey (command handler → playback service → extractor → streamer)
 * can be stitched together in logs.
 *
 * Node crypto.randomUUID is used (available ≥14.17). No external deps.
 */

const { randomUUID } = require("crypto");

function newTraceId() {
  return randomUUID().slice(0, 8);
}

function withTrace(logger, context) {
  const traceId = context?.traceId || newTraceId();
  const enriched = { traceId, ...context };
  return {
    info: (msg, ctx) => logger.info(msg, { ...enriched, ...ctx }),
    warn: (msg, ctx) => logger.warn(msg, { ...enriched, ...ctx }),
    error: (msg, ctx) => logger.error(msg, { ...enriched, ...ctx }),
    debug: (msg, ctx) => logger.debug(msg, { ...enriched, ...ctx }),
    traceId,
    context: enriched,
  };
}

module.exports = {
  newTraceId,
  withTrace,
};
