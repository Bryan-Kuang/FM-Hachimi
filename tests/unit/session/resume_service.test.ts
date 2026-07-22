/**
 * Unit tests for ResumeService — focused on the radio-mode round trip:
 * a session that was in endless radio mode must be re-armed on restore so it
 * keeps rotating instead of playing one track and going idle.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('../../../src/services/logger_service', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

// Track is only used to rehydrate snapshot rows; a thin stand-in is enough.
jest.mock('../../../src/models/track', () => {
  return class FakeTrack {
    [k: string]: any;
    constructor(raw: any, requestedBy: any) {
      Object.assign(this, raw);
      this.requestedBy = requestedBy;
    }
  };
});

import ResumeService = require('../../../src/session/resume_service');

function makePlayer(overrides: any = {}): any {
  return {
    radioMode: false,
    isPlaying: true,
    isPaused: false,
    currentTrack: { title: 'Now Playing' },
    voiceConnection: { joinConfig: { channelId: 'voice-1' } },
    queue: {
      items: [{ bvid: 'BV1', title: 'Now Playing', requestedBy: '📻 Radio' }],
      currentIndex: 0,
      currentTrack: null,
      loopMode: 'none',
      setLoopMode: jest.fn(),
      reset: jest.fn(),
    },
    getCurrentTime: () => 42,
    audioPlayer: { once: jest.fn() },
    joinVoiceChannel: jest.fn().mockResolvedValue(true),
    playCurrentTrack: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeSessionManager(player: any): any {
  return {
    sessions: new Map([['guild-1', { player, uiContext: { channelId: 'text-1' }, history: ['BVx'] }]]),
    get: () => ({ addHistory: jest.fn() }),
  };
}

describe('ResumeService radio mode', () => {
  let tmpFile: string;

  beforeEach(() => {
    tmpFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'resume-')), 'state.json');
  });

  const opts = () => ({ enabled: true, dataFile: tmpFile, maxAgeMs: 60 * 60 * 1000 });

  it('captures radioMode from the player', () => {
    const svc = new ResumeService(opts());

    const radioSnap = svc.capture(makeSessionManager(makePlayer({ radioMode: true })));
    expect(radioSnap.guilds[0].radioMode).toBe(true);

    const plainSnap = svc.capture(makeSessionManager(makePlayer({ radioMode: false })));
    expect(plainSnap.guilds[0].radioMode).toBe(false);
  });

  it('re-arms radio on restore when the snapshot was in radio mode', async () => {
    const svc = new ResumeService(opts());
    // Persist a radio-mode snapshot to disk.
    svc.persist(makeSessionManager(makePlayer({ radioMode: true })));
    expect(fs.existsSync(tmpFile)).toBe(true);

    const player = makePlayer({ radioMode: true });
    const voiceChannel = {
      id: 'voice-1',
      isVoiceBased: () => true,
      guild: { voiceStates: { cache: new Map([['human-1', { channelId: 'voice-1', id: 'human-1' }]]) } },
    };
    const client = {
      user: { id: 'bot-1' },
      channels: { fetch: jest.fn().mockResolvedValue(voiceChannel) },
    };
    const radioService = { resume: jest.fn().mockResolvedValue(undefined) };

    const result = await svc.restore({
      client,
      audioManager: { getPlayer: () => player },
      sessionManager: { get: () => ({ addHistory: jest.fn() }) },
      radioService,
    });

    expect(result.restored).toBe(1);
    expect(radioService.resume).toHaveBeenCalledWith('guild-1', 'text-1');
  });

  describe('auto-snapshot', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('flushes periodically, with the first flush deferred one interval (crash-loop guard)', () => {
      const svc = new ResumeService({ ...opts(), snapshotIntervalMs: 15000 });
      const sm = makeSessionManager(makePlayer({ radioMode: true }));

      svc.startAutoSnapshot(sm);
      // Deferred: nothing written before the first interval elapses.
      expect(fs.existsSync(tmpFile)).toBe(false);

      jest.advanceTimersByTime(15000);
      expect(fs.existsSync(tmpFile)).toBe(true);
      // On-disk shape is discord-voice-resume's own: playback fields live
      // under guilds[0].payload, not flattened at the guild level.
      const first = JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
      expect(first.guilds[0].payload.radioMode).toBe(true);

      jest.advanceTimersByTime(15000);
      expect(fs.existsSync(tmpFile)).toBe(true);

      svc.stopAutoSnapshot();
      fs.unlinkSync(tmpFile);
      jest.advanceTimersByTime(60000);
      // No further writes after stop.
      expect(fs.existsSync(tmpFile)).toBe(false);
    });

    it('does not start a timer when the interval is 0', () => {
      const svc = new ResumeService({ ...opts(), snapshotIntervalMs: 0 });
      svc.startAutoSnapshot(makeSessionManager(makePlayer()));
      jest.advanceTimersByTime(120000);
      expect(fs.existsSync(tmpFile)).toBe(false);
    });
  });

  describe('annoying mode', () => {
    it('captureGuild snapshots one guild, honoring the channel override', () => {
      const svc = new ResumeService(opts());
      const sm = makeSessionManager(makePlayer());

      const state = svc.captureGuild(sm, 'guild-1');
      expect(state).not.toBeNull();
      expect(state!.voiceChannelId).toBe('voice-1');

      const overridden = svc.captureGuild(sm, 'guild-1', 'voice-override');
      expect(overridden!.voiceChannelId).toBe('voice-override');

      expect(svc.captureGuild(sm, 'missing-guild')).toBeNull();
    });

    it('reconstructGuild restores in-process and announces the resurrection', async () => {
      const svc = new ResumeService(opts());
      const state = svc.captureGuild(makeSessionManager(makePlayer()), 'guild-1')!;

      const player = makePlayer();
      const voiceChannel = {
        id: 'voice-1',
        isVoiceBased: () => true,
        guild: { voiceStates: { cache: new Map([['human-1', { channelId: 'voice-1', id: 'human-1' }]]) } },
      };
      const textChannel = { id: 'text-1', send: jest.fn().mockResolvedValue({}) };
      const client = {
        user: { id: 'bot-1' },
        channels: {
          fetch: jest.fn((id: string) =>
            Promise.resolve(id === 'text-1' ? textChannel : voiceChannel),
          ),
        },
      };

      const restored = await svc.reconstructGuild(
        {
          client,
          audioManager: { getPlayer: () => player },
          sessionManager: { get: () => ({ addHistory: jest.fn() }) },
        },
        state,
      );

      expect(restored).toBe(true);
      expect(player.joinVoiceChannel).toHaveBeenCalled();
      expect(player.playCurrentTrack).toHaveBeenCalledWith({ startAtSeconds: 42 });
      // The same "基米永不灭～" announcement as restart resume.
      await new Promise((resolve) => setImmediate(resolve)); // flush the fire-and-forget announceResume
      expect(textChannel.send).toHaveBeenCalledWith(expect.stringContaining('基米永不灭'));
    });
  });

  describe('voice presence (idle) resume', () => {
    // Connected to voice but nothing playing or paused — the state a deploy
    // used to silently kick the bot out of.
    const idlePlayer = (overrides: any = {}) =>
      makePlayer({
        isPlaying: false,
        isPaused: false,
        currentTrack: null,
        queue: {
          items: [],
          currentIndex: -1,
          currentTrack: null,
          loopMode: 'none',
          setLoopMode: jest.fn(),
          reset: jest.fn(),
        },
        ...overrides,
      });

    const makeVoiceChannel = () => ({
      id: 'voice-1',
      isVoiceBased: () => true,
      guild: {
        voiceStates: {
          cache: new Map([['human-1', { channelId: 'voice-1', id: 'human-1' }]]),
        },
      },
    });

    it('captureGuild captures a connected-but-idle session as presence-only state', () => {
      const svc = new ResumeService(opts());

      const state = svc.captureGuild(makeSessionManager(idlePlayer()), 'guild-1');

      expect(state).not.toBeNull();
      expect(state!.voiceChannelId).toBe('voice-1');
      expect(state!.tracks).toEqual([]);
      expect(state!.radioMode).toBe(false);
    });

    it('captureGuild still returns null when there is no voice connection', () => {
      const svc = new ResumeService(opts());
      const state = svc.captureGuild(
        makeSessionManager(idlePlayer({ voiceConnection: null })),
        'guild-1',
      );
      expect(state).toBeNull();
    });

    it('persist writes a snapshot for a connected-but-idle session', () => {
      const svc = new ResumeService(opts());
      svc.persist(makeSessionManager(idlePlayer()));
      expect(fs.existsSync(tmpFile)).toBe(true);
    });

    it('restore rejoins the channel without starting playback or announcing', async () => {
      const svc = new ResumeService(opts());
      svc.persist(makeSessionManager(idlePlayer()));

      const player = idlePlayer();
      const voiceChannel = makeVoiceChannel();
      const textChannel = { id: 'text-1', send: jest.fn().mockResolvedValue({}) };
      const client = {
        user: { id: 'bot-1' },
        channels: {
          fetch: jest.fn((id: string) =>
            Promise.resolve(id === 'text-1' ? textChannel : voiceChannel),
          ),
        },
      };

      const result = await svc.restore({
        client,
        audioManager: { getPlayer: () => player },
        sessionManager: { get: () => ({ addHistory: jest.fn() }) },
      });

      expect(result.restored).toBe(1);
      expect(player.joinVoiceChannel).toHaveBeenCalledWith(voiceChannel);
      expect(player.playCurrentTrack).not.toHaveBeenCalled();
      await new Promise((resolve) => setImmediate(resolve));
      expect(textChannel.send).not.toHaveBeenCalled();
    });

    it('restarts radio rotation via radioService.start for a presence-only radio snapshot', async () => {
      const svc = new ResumeService(opts());
      svc.persist(makeSessionManager(idlePlayer({ radioMode: true })));

      const player = idlePlayer({ radioMode: true });
      const voiceChannel = makeVoiceChannel();
      const client = {
        user: { id: 'bot-1' },
        channels: { fetch: jest.fn().mockResolvedValue(voiceChannel) },
      };
      const radioService = {
        start: jest.fn().mockResolvedValue({ success: true }),
        resume: jest.fn().mockResolvedValue(undefined),
      };

      const result = await svc.restore({
        client,
        audioManager: { getPlayer: () => player },
        sessionManager: { get: () => ({ addHistory: jest.fn() }) },
        radioService,
      });

      expect(result.restored).toBe(1);
      expect(radioService.start).toHaveBeenCalledWith('guild-1', voiceChannel, 'text-1');
      // resume() assumes a restored track is already playing — wrong here.
      expect(radioService.resume).not.toHaveBeenCalled();
    });

    it('restarts radio in an empty channel too (radio-station behavior)', async () => {
      // Option A: a presence-only radio snapshot re-arms rotation regardless of
      // who is listening — the bot is a station, not an on-demand player.
      const svc = new ResumeService(opts());
      svc.persist(makeSessionManager(idlePlayer({ radioMode: true })));

      const player = idlePlayer({ radioMode: true });
      const voiceChannel = {
        id: 'voice-1',
        isVoiceBased: () => true,
        guild: { voiceStates: { cache: new Map() } },
      };
      const client = {
        user: { id: 'bot-1' },
        channels: { fetch: jest.fn().mockResolvedValue(voiceChannel) },
      };
      const radioService = {
        start: jest.fn().mockResolvedValue({ success: true }),
        resume: jest.fn().mockResolvedValue(undefined),
      };

      const result = await svc.restore({
        client,
        audioManager: { getPlayer: () => player },
        sessionManager: { get: () => ({ addHistory: jest.fn() }) },
        radioService,
      });

      expect(result.restored).toBe(1);
      expect(player.joinVoiceChannel).toHaveBeenCalledWith(voiceChannel);
      // Empty room no longer suppresses radio.
      expect(radioService.start).toHaveBeenCalledWith('guild-1', voiceChannel, 'text-1');
    });

    it('resumes a playback snapshot even when the channel is empty (radio-station behavior)', async () => {
      // Option A supersedes the old 2026-07-09 downgrade: the bot still always
      // rejoins (eviction stays fixed), but now also resumes playback instead of
      // coming back silently.
      const svc = new ResumeService(opts());
      svc.persist(makeSessionManager(makePlayer({ radioMode: true })));

      const player = makePlayer({ radioMode: true });
      const voiceChannel = {
        id: 'voice-1',
        isVoiceBased: () => true,
        guild: { voiceStates: { cache: new Map() } },
      };
      const textChannel = { id: 'text-1', send: jest.fn().mockResolvedValue({}) };
      const client = {
        user: { id: 'bot-1' },
        channels: {
          fetch: jest.fn((id: string) =>
            Promise.resolve(id === 'text-1' ? textChannel : voiceChannel),
          ),
        },
      };
      const radioService = {
        start: jest.fn().mockResolvedValue({ success: true }),
        resume: jest.fn().mockResolvedValue(undefined),
      };

      const result = await svc.restore({
        client,
        audioManager: { getPlayer: () => player },
        sessionManager: { get: () => ({ addHistory: jest.fn() }) },
        radioService,
      });

      expect(result.restored).toBe(1);
      expect(player.joinVoiceChannel).toHaveBeenCalledWith(voiceChannel);
      // Playback resumes, and radio re-arms via resume() (track already playing).
      expect(player.playCurrentTrack).toHaveBeenCalledWith({ startAtSeconds: 42 });
      expect(radioService.resume).toHaveBeenCalledWith('guild-1', 'text-1');
      await new Promise((resolve) => setImmediate(resolve));
      expect(textChannel.send).toHaveBeenCalledWith(expect.stringContaining('基米永不灭'));
    });
  });

  it('does not call radioService.resume for a non-radio snapshot', async () => {
    const svc = new ResumeService(opts());
    svc.persist(makeSessionManager(makePlayer({ radioMode: false })));

    const player = makePlayer({ radioMode: false });
    const voiceChannel = {
      id: 'voice-1',
      isVoiceBased: () => true,
      guild: { voiceStates: { cache: new Map([['human-1', { channelId: 'voice-1', id: 'human-1' }]]) } },
    };
    const client = {
      user: { id: 'bot-1' },
      channels: { fetch: jest.fn().mockResolvedValue(voiceChannel) },
    };
    const radioService = { resume: jest.fn().mockResolvedValue(undefined) };

    await svc.restore({
      client,
      audioManager: { getPlayer: () => player },
      sessionManager: { get: () => ({ addHistory: jest.fn() }) },
      radioService,
    });

    expect(radioService.resume).not.toHaveBeenCalled();
  });
});
