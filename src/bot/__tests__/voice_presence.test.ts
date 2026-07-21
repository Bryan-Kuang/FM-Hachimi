/* eslint-disable @typescript-eslint/no-explicit-any */

import { isFirstListenerJoin } from '../voice_presence';

const BOT = 'bot-1';

/** Build a members collection stand-in from a list of {id, bot}. */
function members(list: Array<{ id: string; bot?: boolean }>) {
  return {
    has: (id: string) => list.some((m) => m.id === id),
    // discord.js Collection.filter returns a Collection (has .size); the real
    // Array.prototype.filter used here exposes .length.
    filter: (fn: (m: any) => boolean) => ({
      size: list.filter((m) => fn({ user: { bot: !!m.bot } })).length,
    }),
  };
}

function channel(id: string, list: Array<{ id: string; bot?: boolean }>) {
  return { id, members: members(list) };
}

describe('isFirstListenerJoin', () => {
  it('is true when the first human joins the bot channel', () => {
    const oldState = { channelId: null, member: { user: { bot: false } }, channel: null };
    const newState = {
      channelId: 'voice-1',
      member: { user: { bot: false } },
      channel: channel('voice-1', [{ id: BOT, bot: true }, { id: 'human-1' }]),
    };
    expect(isFirstListenerJoin(oldState, newState, BOT)).toBe(true);
  });

  it('is false when a second human joins (already occupied)', () => {
    const newState = {
      channelId: 'voice-1',
      member: { user: { bot: false } },
      channel: channel('voice-1', [{ id: BOT, bot: true }, { id: 'human-1' }, { id: 'human-2' }]),
    };
    expect(isFirstListenerJoin({ channelId: null }, newState, BOT)).toBe(false);
  });

  it('is false for the bot joining its own channel', () => {
    const newState = {
      channelId: 'voice-1',
      member: { user: { bot: true } },
      channel: channel('voice-1', [{ id: BOT, bot: true }]),
    };
    expect(isFirstListenerJoin({ channelId: null }, newState, BOT)).toBe(false);
  });

  it('is false for a same-channel self-update (mute/deafen)', () => {
    const ch = channel('voice-1', [{ id: BOT, bot: true }, { id: 'human-1' }]);
    const oldState = { channelId: 'voice-1', member: { user: { bot: false } }, channel: ch };
    const newState = { channelId: 'voice-1', member: { user: { bot: false } }, channel: ch };
    expect(isFirstListenerJoin(oldState, newState, BOT)).toBe(false);
  });

  it('is false when the bot is not in the joined channel', () => {
    const newState = {
      channelId: 'voice-2',
      member: { user: { bot: false } },
      channel: channel('voice-2', [{ id: 'human-1' }]),
    };
    expect(isFirstListenerJoin({ channelId: null }, newState, BOT)).toBe(false);
  });

  it('is false for a leave (no new channel)', () => {
    const oldState = { channelId: 'voice-1', member: { user: { bot: false } } };
    const newState = { channelId: null, member: { user: { bot: false } }, channel: null };
    expect(isFirstListenerJoin(oldState, newState, BOT)).toBe(false);
  });
});
