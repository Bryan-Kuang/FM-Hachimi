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
  private tail: Promise<void>;
  count: number;
  private readonly maxWaiting: number;

  constructor(maxWaiting = 1) {
    this.tail = Promise.resolve();
    this.count = 0;
    this.maxWaiting = maxWaiting;
  }

  isFull(): boolean {
    return this.count >= 1 + this.maxWaiting;
  }

  isWaiting(): boolean {
    return this.count > 1;
  }

  run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.isFull()) {
      throw new Error('Queue full');
    }
    this.count++;

    const chainBase = this.tail.catch(() => {});
    const result = chainBase.then(() => fn());

    this.tail = result.finally(() => { this.count--; }).catch(() => {}) as Promise<void>;

    return result;
  }
}

class CommandQueueManager {
  private queues: Map<string, GuildCommandQueue>;

  constructor() {
    this.queues = new Map();
  }

  private getQueue(guildId: string, command: string): GuildCommandQueue {
    const key = `${guildId}:${command}`;
    if (!this.queues.has(key)) {
      this.queues.set(key, new GuildCommandQueue());
    }
    return this.queues.get(key)!;
  }

  run<T>(guildId: string, command: string, fn: () => Promise<T>): Promise<T> {
    const queue = this.getQueue(guildId, command);
    const result = queue.run(fn);
    result.catch(() => {}).finally(() => {
      if (queue.count === 0) {
        this.queues.delete(`${guildId}:${command}`);
      }
    });
    return result;
  }
}

export = new CommandQueueManager();
