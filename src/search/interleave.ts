/**
 * Round-robin interleaving of multiple ranked lists into one ordered list,
 * used to combine per-platform search results (Bilibili / YouTube / Spotify)
 * into a single numbered list without any platform dominating the front.
 */

/**
 * Interleaves `lists` in round-robin order, preserving each list's own
 * internal order and the array order of `lists` itself as the tie-break
 * within a round. Exhausted lists are skipped (no gaps/placeholders).
 *
 * @example
 * interleaveRoundRobin([[b1, b2], [y1], [s1, s2, s3]])
 * // → [b1, y1, s1, b2, s2, s3]
 */
export function interleaveRoundRobin<T>(lists: T[][]): T[] {
  const result: T[] = [];
  const maxLength = lists.reduce((max, list) => Math.max(max, list.length), 0);

  for (let i = 0; i < maxLength; i++) {
    for (const list of lists) {
      if (i < list.length) result.push(list[i]);
    }
  }

  return result;
}
