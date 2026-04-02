/**
 * Per-guild command execution queue
 * Serializes concurrent executions of the same command within a guild,
 * preventing race conditions on shared player/queue state.
 *
 * Capacity: 1 running + 1 waiting per (guild, command) pair.
 * A third concurrent invocation is rejected (caller receives thrown Error).
 * Queues are automatically removed from the map when idle.
 */

class GuildCommandQueue {
  constructor(maxWaiting = 1) {
    this.tail = Promise.resolve();
    this.count = 0; // running + waiting
    this.maxWaiting = maxWaiting;
  }

  /** True if no more tasks can be accepted right now */
  isFull() {
    return this.count >= 1 + this.maxWaiting;
  }

  /** True if at least one task is already waiting (not yet started) */
  isWaiting() {
    return this.count > 1;
  }

  /**
   * Enqueue fn to run after the current task finishes.
   * Returns the Promise for fn's result (errors propagate to caller).
   * Throws synchronously if the queue is full.
   */
  run(fn) {
    if (this.isFull()) {
      throw new Error("Queue full");
    }
    this.count++;

    // Chain off tail; swallow prior errors so a failed task doesn't block the next
    const chainBase = this.tail.catch(() => {});
    const result = chainBase.then(() => fn());

    // Advance tail; swallow result errors so the chain stays alive
    this.tail = result.finally(() => { this.count--; }).catch(() => {});

    return result; // caller gets proper error propagation
  }
}

class CommandQueueManager {
  constructor() {
    /** @type {Map<string, GuildCommandQueue>} */
    this.queues = new Map();
  }

  /**
   * Get (or lazily create) the queue for a guild+command pair.
   * @param {string} guildId
   * @param {string} command
   * @returns {GuildCommandQueue}
   */
  getQueue(guildId, command) {
    const key = `${guildId}:${command}`;
    if (!this.queues.has(key)) {
      this.queues.set(key, new GuildCommandQueue());
    }
    return this.queues.get(key);
  }

  /**
   * Enqueue fn under the given guild+command slot.
   * Auto-removes the queue entry when it goes idle.
   * @param {string} guildId
   * @param {string} command
   * @param {Function} fn  Async function to execute
   * @returns {Promise}    Resolves/rejects with fn's result
   * @throws {Error}       Synchronously if queue is full
   */
  run(guildId, command, fn) {
    const queue = this.getQueue(guildId, command);
    const result = queue.run(fn);
    // Clean up map entry when queue drains to zero
    result.catch(() => {}).finally(() => {
      if (queue.count === 0) {
        this.queues.delete(`${guildId}:${command}`);
      }
    });
    return result;
  }
}

module.exports = new CommandQueueManager();
