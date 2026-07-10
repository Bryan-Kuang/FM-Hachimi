/**
 * ResumeService — playback survival across restarts/redeploys.
 * Covers snapshot capture/persist on shutdown and consume/restore on startup.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ResumeService = require('../../src/session/resume_service');
const GuildSession = require('../../src/session/guild_session');
const Track = require('../../src/models/track');

function makeTrackData(overrides = {}) {
  return {
    bvid: 'BV1xx',
    title: 'Test Song',
    audioUrl: 'https://cdn.example.com/audio.m4a',
    normalizedUrl: 'https://www.bilibili.com/video/BV1xx',
    duration: 240,
    platform: 'bilibili',
    extractedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makePlayingPlayer({
  channelId = 'vc-1',
  tracks = [new Track(makeTrackData(), '<@user1>')],
  index = 0,
  position = 42,
  playing = true,
  paused = false,
} = {}) {
  return {
    voiceConnection: { joinConfig: { channelId } },
    currentTrack: tracks[index] || null,
    isPlaying: playing,
    isPaused: paused,
    queue: { items: tracks, currentIndex: index, loopMode: 'queue' },
    getCurrentTime: () => position,
  };
}

function makeSessionManager() {
  const sessions = new Map();
  return {
    sessions,
    get(guildId) {
      if (!sessions.has(guildId)) sessions.set(guildId, new GuildSession(guildId));
      return sessions.get(guildId);
    },
  };
}

function makeVoiceChannel({ humans = 1, membersCached = true, bots = 1 } = {}) {
  // Mirrors discord.js: occupancy lives in guild.voiceStates.cache, and each
  // voice state's .member resolves from the guild member cache — which is
  // empty right after startup (no GuildMembers intent).
  const voiceStates = new Map();
  for (let i = 0; i < bots; i++) {
    voiceStates.set(`bot-${i}`, {
      id: `bot-${i}`,
      channelId: 'vc-1',
      member: membersCached ? { user: { bot: true } } : null,
    });
  }
  for (let i = 0; i < humans; i++) {
    voiceStates.set(`user-${i}`, {
      id: `user-${i}`,
      channelId: 'vc-1',
      member: membersCached ? { user: { bot: false } } : null,
    });
  }
  return {
    id: 'vc-1',
    isVoiceBased: () => true,
    guild: { id: 'g1', voiceAdapterCreator: {}, voiceStates: { cache: voiceStates } },
  };
}

function makeRestorePlayer() {
  const queue = {
    items: [],
    currentIndex: -1,
    currentTrack: null,
    loopMode: 'none',
    setLoopMode: jest.fn(function (mode) { this.loopMode = mode; }),
    reset: jest.fn(),
  };
  return {
    queue,
    joinVoiceChannel: jest.fn().mockResolvedValue(true),
    playCurrentTrack: jest.fn().mockResolvedValue(true),
    audioPlayer: { once: jest.fn() },
    pause: jest.fn(),
  };
}

describe('ResumeService', () => {
  let tmpDir;
  let dataFile;
  let service;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-test-'));
    dataFile = path.join(tmpDir, 'resume_state.json');
    service = new ResumeService({ enabled: true, dataFile, maxAgeMs: 15 * 60 * 1000 });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('capture', () => {
    test('captures every connected session: playing, paused, and idle (presence only)', () => {
      const sm = makeSessionManager();
      sm.get('g-playing').player = makePlayingPlayer();
      sm.get('g-paused').player = makePlayingPlayer({ playing: false, paused: true });
      sm.get('g-idle').player = makePlayingPlayer({ playing: false, paused: false });
      sm.get('g-disconnected').player = Object.assign(makePlayingPlayer(), { voiceConnection: null });
      sm.get('g-noplayer'); // session without a player

      const snapshot = service.capture(sm);

      const ids = snapshot.guilds.map((g) => g.guildId).sort();
      expect(ids).toEqual(['g-idle', 'g-paused', 'g-playing']);
      const paused = snapshot.guilds.find((g) => g.guildId === 'g-paused');
      expect(paused.isPaused).toBe(true);
      // Idle-but-connected becomes a presence-only state: no tracks to resume,
      // just the channel to rejoin.
      const idle = snapshot.guilds.find((g) => g.guildId === 'g-idle');
      expect(idle.tracks).toEqual([]);
    });

    test('records queue, cursor, position, loop mode, and history', () => {
      const sm = makeSessionManager();
      const tracks = [
        new Track(makeTrackData({ title: 'One' }), '<@u1>'),
        new Track(makeTrackData({ title: 'Two' }), '<@u2>'),
      ];
      const session = sm.get('g1');
      session.player = makePlayingPlayer({ tracks, index: 1, position: 77 });
      session.uiContext = { channelId: 'text-1', messageId: 'msg-1' };
      session.addHistory('BVaaa');
      session.addHistory('BVbbb');

      const [state] = service.capture(sm).guilds;

      expect(state.voiceChannelId).toBe('vc-1');
      expect(state.textChannelId).toBe('text-1');
      expect(state.tracks).toHaveLength(2);
      expect(state.tracks[1].title).toBe('Two');
      expect(state.tracks[1].requestedBy).toBe('<@u2>');
      expect(state.currentIndex).toBe(1);
      expect(state.positionSeconds).toBe(77);
      expect(state.loopMode).toBe('queue');
      expect(state.history).toEqual(['BVaaa', 'BVbbb']);
    });
  });

  describe('persist / consume', () => {
    test('round-trips a snapshot and deletes the file on consume', () => {
      const sm = makeSessionManager();
      sm.get('g1').player = makePlayingPlayer();

      service.persist(sm);
      expect(fs.existsSync(dataFile)).toBe(true);

      const snapshot = service.consume();
      expect(snapshot.guilds).toHaveLength(1);
      expect(snapshot.guilds[0].guildId).toBe('g1');
      // delete-on-read: the same snapshot is never resumed twice
      expect(fs.existsSync(dataFile)).toBe(false);
      expect(service.consume()).toBeNull();
    });

    test('persist with no active sessions removes a stale snapshot file', () => {
      fs.writeFileSync(dataFile, JSON.stringify({ savedAt: new Date().toISOString(), guilds: [] }));
      service.persist(makeSessionManager());
      expect(fs.existsSync(dataFile)).toBe(false);
    });

    test('consume discards expired snapshots', () => {
      const sm = makeSessionManager();
      sm.get('g1').player = makePlayingPlayer();
      const snapshot = service.capture(sm);
      snapshot.savedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      fs.writeFileSync(dataFile, JSON.stringify(snapshot));

      expect(service.consume()).toBeNull();
      expect(fs.existsSync(dataFile)).toBe(false);
    });

    test('consume discards corrupt snapshots without throwing', () => {
      fs.writeFileSync(dataFile, 'not json {');
      expect(service.consume()).toBeNull();
    });

    test('disabled service never writes or reads', () => {
      const disabled = new ResumeService({ enabled: false, dataFile, maxAgeMs: 1000 });
      const sm = makeSessionManager();
      sm.get('g1').player = makePlayingPlayer();

      disabled.persist(sm);
      expect(fs.existsSync(dataFile)).toBe(false);

      fs.writeFileSync(dataFile, JSON.stringify({ savedAt: new Date().toISOString(), guilds: [{}] }));
      expect(disabled.consume()).toBeNull();
      expect(fs.existsSync(dataFile)).toBe(true);
    });
  });

  describe('restore', () => {
    function persistSnapshot({ position = 42, paused = false, tracks, index = 0 } = {}) {
      const sm = makeSessionManager();
      const session = sm.get('g1');
      session.player = makePlayingPlayer({
        tracks: tracks || [
          new Track(makeTrackData({ title: 'One' }), '<@u1>'),
          new Track(makeTrackData({ title: 'Two' }), '<@u2>'),
        ],
        index,
        position,
        playing: !paused,
        paused,
      });
      session.uiContext = { channelId: 'text-1', messageId: 'msg-1' };
      session.addHistory('BVaaa');
      service.persist(sm);
    }

    function makeDeps({ voiceChannel = makeVoiceChannel(), player = makeRestorePlayer() } = {}) {
      const textChannel = { send: jest.fn().mockResolvedValue(undefined) };
      const client = {
        isReady: () => true,
        user: { id: 'bot-0' },
        channels: {
          fetch: jest.fn(async (id) => {
            if (id === 'vc-1') return voiceChannel;
            if (id === 'text-1') return textChannel;
            return null;
          }),
        },
      };
      const audioManager = { getPlayer: jest.fn(() => player) };
      const sessionManager = makeSessionManager();
      return { deps: { client, audioManager, sessionManager }, player, textChannel };
    }

    test('rejoins voice, rebuilds the queue, and resumes at the saved position', async () => {
      persistSnapshot({ position: 42, index: 1 });
      const { deps, player, textChannel } = makeDeps();

      const result = await service.restore(deps);

      expect(result).toEqual({ restored: 1, skipped: 0 });
      expect(player.queue.items).toHaveLength(2);
      expect(player.queue.items[0]).toBeInstanceOf(Track);
      expect(player.queue.currentIndex).toBe(1);
      expect(player.queue.currentTrack.title).toBe('Two');
      expect(player.queue.setLoopMode).toHaveBeenCalledWith('queue');
      expect(player.joinVoiceChannel).toHaveBeenCalled();
      expect(player.playCurrentTrack).toHaveBeenCalledWith({ startAtSeconds: 42 });
      expect(deps.sessionManager.get('g1').hasHistory('BVaaa')).toBe(true);
      expect(textChannel.send).toHaveBeenCalledWith(expect.stringContaining('Two'));
    });

    test('re-pauses a session that was paused at shutdown', async () => {
      persistSnapshot({ paused: true });
      const { deps, player } = makeDeps();

      await service.restore(deps);

      expect(player.audioPlayer.once).toHaveBeenCalledWith('playing', expect.any(Function));
      const onPlaying = player.audioPlayer.once.mock.calls[0][1];
      onPlaying();
      expect(player.pause).toHaveBeenCalled();
    });

    test('rejoins a channel with no human listeners but does not resume playback', async () => {
      persistSnapshot();
      const { deps, player } = makeDeps({ voiceChannel: makeVoiceChannel({ humans: 0 }) });

      const result = await service.restore(deps);

      expect(result).toEqual({ restored: 1, skipped: 0 });
      expect(player.joinVoiceChannel).toHaveBeenCalled();
      expect(player.playCurrentTrack).not.toHaveBeenCalled();
    });

    test('resumes when occupants exist but their members are not cached yet', async () => {
      // Right after startup the guild member cache holds only the bot, so
      // channel.members is empty even though humans are connected. Occupancy
      // must come from voice states, treating unknown occupants as humans.
      persistSnapshot();
      const { deps, player } = makeDeps({
        voiceChannel: makeVoiceChannel({ humans: 1, membersCached: false }),
      });

      const result = await service.restore(deps);

      expect(result).toEqual({ restored: 1, skipped: 0 });
      expect(player.playCurrentTrack).toHaveBeenCalledWith({ startAtSeconds: 42 });
    });

    test('rejoins without playback when only the bot itself remains and members are uncached', async () => {
      persistSnapshot();
      const { deps, player } = makeDeps({
        voiceChannel: makeVoiceChannel({ humans: 0, membersCached: false }),
      });

      const result = await service.restore(deps);

      expect(result).toEqual({ restored: 1, skipped: 0 });
      expect(player.joinVoiceChannel).toHaveBeenCalled();
      expect(player.playCurrentTrack).not.toHaveBeenCalled();
    });

    test('skips when the voice channel no longer exists', async () => {
      persistSnapshot();
      const { deps, player } = makeDeps();
      deps.client.channels.fetch = jest.fn().mockResolvedValue(null);

      const result = await service.restore(deps);

      expect(result).toEqual({ restored: 0, skipped: 1 });
      expect(player.playCurrentTrack).not.toHaveBeenCalled();
    });

    test('resets the queue when rejoining fails', async () => {
      persistSnapshot();
      const player = makeRestorePlayer();
      player.joinVoiceChannel.mockResolvedValue(false);
      const { deps } = makeDeps({ player });

      const result = await service.restore(deps);

      expect(result).toEqual({ restored: 0, skipped: 1 });
      expect(player.queue.reset).toHaveBeenCalled();
      expect(player.playCurrentTrack).not.toHaveBeenCalled();
    });

    test('a failing guild does not block the others', async () => {
      // Two guilds in one snapshot: first throws on join, second succeeds
      const sm = makeSessionManager();
      sm.get('g1').player = makePlayingPlayer({ channelId: 'vc-1' });
      sm.get('g2').player = makePlayingPlayer({ channelId: 'vc-1' });
      service.persist(sm);

      const goodPlayer = makeRestorePlayer();
      const badPlayer = makeRestorePlayer();
      badPlayer.joinVoiceChannel.mockRejectedValue(new Error('boom'));
      const voiceChannel = makeVoiceChannel();
      const client = {
        isReady: () => true,
        channels: { fetch: jest.fn().mockResolvedValue(voiceChannel) },
      };
      const audioManager = {
        getPlayer: jest.fn((guildId) => (guildId === 'g1' ? badPlayer : goodPlayer)),
      };

      const result = await service.restore({ client, audioManager, sessionManager: makeSessionManager() });

      expect(result).toEqual({ restored: 1, skipped: 1 });
      expect(goodPlayer.playCurrentTrack).toHaveBeenCalled();
    });
  });
});
