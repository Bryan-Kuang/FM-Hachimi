/**
 * Voice-presence predicates for the voiceStateUpdate handler.
 *
 * Kept as pure functions (no discord.js imports) so the "first listener
 * arrived" decision can be unit-tested without a live client.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Minimal shape of a discord.js VoiceState we depend on. */
interface VoiceStateLike {
  channelId?: string | null;
  member?: { user?: { bot?: boolean } } | null;
  channel?: {
    id: string;
    members: {
      has(id: string): boolean;
      filter(fn: (m: any) => boolean): { size: number };
    };
  } | null;
}

/**
 * True when `newState` represents a non-bot user joining (or being moved into)
 * the channel the bot is currently sitting in, and they are the FIRST human
 * there — i.e. the empty→occupied transition. Two humans arriving at once fire
 * separate events; only the one that lands on a count of exactly 1 returns true.
 */
export function isFirstListenerJoin(
  oldState: VoiceStateLike,
  newState: VoiceStateLike,
  botUserId: string,
): boolean {
  const member = newState.member;
  if (!member || member.user?.bot) return false; // ignore bots, incl. our own
  const channel = newState.channel;
  if (!channel) return false; // a leave, not a join
  if (oldState.channelId === newState.channelId) return false; // same channel: mute/deafen self-update
  if (!channel.members.has(botUserId)) return false; // bot isn't in this channel
  const humanCount = channel.members.filter((m: any) => !m.user?.bot).size;
  return humanCount === 1;
}
