/* eslint-disable @typescript-eslint/no-explicit-any */

jest.mock('../../services/logger_service', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../embeds', () => ({
  createNowPlayingEmbed: jest.fn(() => ({ embed: true })),
}));
jest.mock('../buttons', () => ({
  createPlaybackControls: jest.fn(() => []),
}));

import InterfaceUpdater = require('../interface_updater');

function setup(overrides: any = {}) {
  const session: any = {
    uiContext: { channelId: 'text-1', messageId: 'old-msg' },
    uiSeq: 0,
  };
  const sessionManager: any = { get: jest.fn(() => session) };
  const progressTracker: any = { startTracking: jest.fn(), stopTracking: jest.fn() };
  const player: any = {
    currentTrack: { title: 'Song', requestedBy: 'u' },
    isPlaying: true,
    isPaused: false,
    getCurrentTime: () => 5,
    currentIndex: 0,
    queue: { length: 1 },
    loopMode: 'none',
    radioMode: false,
    radioBreak: false,
    canGoBack: () => false,
    canSkip: () => false,
    ...overrides.player,
  };
  const audioManager: any = { getPlayer: () => player };

  const channel: any = {
    messages: {
      edit: jest.fn().mockResolvedValue({ id: 'edited' }),
      delete: jest.fn().mockResolvedValue(undefined),
    },
    send: jest.fn().mockResolvedValue({ id: 'new-msg' }),
  };
  const client: any = {
    channels: { cache: { get: () => channel }, fetch: jest.fn().mockResolvedValue(channel) },
  };

  const updater = new InterfaceUpdater(sessionManager, progressTracker, audioManager);
  updater.setClient(client);
  return { updater, session, channel, sessionManager };
}

describe('InterfaceUpdater.repostNowPlaying', () => {
  it('deletes the old card, sends a fresh one, and repoints uiContext', async () => {
    const { updater, session, channel } = setup();

    await updater.repostNowPlaying('guild-1');

    expect(channel.messages.delete).toHaveBeenCalledWith('old-msg');
    expect(channel.send).toHaveBeenCalled();
    expect(session.uiContext).toEqual({ channelId: 'text-1', messageId: 'new-msg' });
  });

  it('no-ops when there is no live card', async () => {
    const { updater, session, channel } = setup();
    session.uiContext = { channelId: 'text-1', messageId: '' };

    await updater.repostNowPlaying('guild-1');

    expect(channel.messages.delete).not.toHaveBeenCalled();
    expect(channel.send).not.toHaveBeenCalled();
  });

  it('no-ops when nothing is playing', async () => {
    const { updater, channel } = setup({ player: { currentTrack: null } });

    await updater.repostNowPlaying('guild-1');

    expect(channel.messages.delete).not.toHaveBeenCalled();
    expect(channel.send).not.toHaveBeenCalled();
  });

  it('respects the cooldown on a rapid second call', async () => {
    const { updater, channel, session } = setup();

    await updater.repostNowPlaying('guild-1');
    expect(channel.send).toHaveBeenCalledTimes(1);

    // Simulate the buried-card state again and fire immediately.
    session.uiContext = { channelId: 'text-1', messageId: 'old-msg-2' };
    await updater.repostNowPlaying('guild-1');

    expect(channel.messages.delete).toHaveBeenCalledTimes(1);
    expect(channel.send).toHaveBeenCalledTimes(1);
  });
});
