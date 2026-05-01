const locks = new Map<string, boolean>();
const lastTimes = new Map<string, number>();

function keyOf(guildId: string, action: string): string {
  return `${guildId}:${action}`;
}

export function acquire(guildId: string, action: string): boolean {
  const k = keyOf(guildId, action);
  if (locks.get(k)) return false;
  locks.set(k, true);
  return true;
}

export function release(guildId: string, action: string): void {
  locks.delete(keyOf(guildId, action));
}

export function shouldDebounce(guildId: string, action: string, ms: number): boolean {
  const k = keyOf(guildId, action);
  const now = Date.now();
  const last = lastTimes.get(k) ?? 0;
  if (now - last < ms) return true;
  lastTimes.set(k, now);
  if (lastTimes.size > 100) {
    for (const [key, time] of lastTimes) {
      if (now - time > 60000) lastTimes.delete(key);
    }
  }
  return false;
}

