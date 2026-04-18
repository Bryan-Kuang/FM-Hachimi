/**
 * JS bridge to the TypeScript ShadowRunner.
 *
 * The TS runner at ./shadow_runner.ts is consumed directly by ts-jest
 * in tests, but legacy JS modules (e.g. audio_player.js) cannot
 * require a raw .ts file at runtime. This bridge provides a stable
 * JS-requirable entry point that:
 *
 *   1. Returns a no-op stub unless SHADOW_MODE_ENABLED=true. This keeps
 *      production untouched by default.
 *   2. When enabled, tries to require the compiled output from dist/.
 *      If the build hasn't been run, falls back to the stub with a
 *      warning rather than crashing.
 *   3. Guarantees any runtime failure is swallowed. The shadow layer
 *      must NEVER impact the legacy path it observes.
 */

function createDisabledRunner() {
  return {
    enabled: false,
    dispatch() { return { kind: "idle" }; },
    compareOutcome() { /* no-op */ },
    reset() { /* no-op */ },
    getState() { return { kind: "idle" }; },
  };
}

function tryLoadCompiled() {
  // Two plausible build outputs — depending on tsconfig rootDir vs. outDir
  // layout, the compiled module can land under dist/src/... or dist/app/...
  const candidates = [
    "../../dist/src/app/shadow_runner",
    "../../dist/app/shadow_runner",
  ];
  for (const rel of candidates) {
    try {
      return require(rel);
    } catch (_err) {
      // try next candidate
    }
  }
  return null;
}

function createShadowRunner(guildId, logger, env = process.env, loader = tryLoadCompiled) {
  if (env.SHADOW_MODE_ENABLED !== "true") {
    return createDisabledRunner();
  }
  const mod = loader();
  if (!mod || typeof mod.createShadowRunner !== "function") {
    if (logger && typeof logger.warn === "function") {
      logger.warn("SHADOW_MODE_ENABLED=true but compiled shadow runner not found; run `npm run build`.");
    }
    return createDisabledRunner();
  }
  try {
    const runner = mod.createShadowRunner(guildId, logger, env);
    // Wrap every method to swallow runtime exceptions — defense in depth.
    return wrapSafe(runner, logger);
  } catch (err) {
    if (logger && typeof logger.warn === "function") {
      logger.warn("Failed to instantiate shadow runner; reverting to disabled stub", {
        error: err && err.message,
      });
    }
    return createDisabledRunner();
  }
}

function wrapSafe(runner, logger) {
  const safe = {
    get enabled() { return runner.enabled === true; },
  };
  for (const method of ["dispatch", "compareOutcome", "reset", "getState"]) {
    safe[method] = function (...args) {
      try {
        return runner[method](...args);
      } catch (err) {
        if (logger && typeof logger.warn === "function") {
          logger.warn(`shadow runner ${method}() threw; swallowing`, {
            error: err && err.message,
          });
        }
        if (method === "getState") return { kind: "idle" };
        return undefined;
      }
    };
  }
  return safe;
}

module.exports = { createShadowRunner, createDisabledRunner };
