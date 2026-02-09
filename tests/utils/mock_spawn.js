const { EventEmitter } = require("events");

/**
 * Create a mock child process that simulates spawn() behavior.
 * Usage: jest.mock('child_process') then spawn.mockReturnValue(createMockProcess(...))
 */
function createMockProcess({ stdout = "", stderr = "", exitCode = 0, error = null } = {}) {
  const proc = new EventEmitter();

  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = { end: jest.fn(), destroyed: false };
  proc.killed = false;
  proc.kill = jest.fn(() => { proc.killed = true; });

  // Emit data and close on next tick so callers can attach listeners first
  process.nextTick(() => {
    if (error) {
      proc.emit("error", error);
      return;
    }
    if (stdout) proc.stdout.emit("data", Buffer.from(stdout));
    if (stderr) proc.stderr.emit("data", Buffer.from(stderr));
    proc.emit("close", exitCode);
  });

  return proc;
}

module.exports = { createMockProcess };
