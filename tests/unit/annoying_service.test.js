/**
 * Unit tests for AnnoyingService (/annoying 反谋害模式)
 * Covers toggle semantics, exempt-user matching, self-leave/self-move
 * detection, and the fight-back paths (reconstruction + move-back).
 */

jest.mock('../../src/services/logger_service', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../../src/utils/audit_log', () => ({
  findRecentAuditExecutor: jest.fn(),
}));

const AuditLog = require('../../src/utils/audit_log');
const AnnoyingService = require('../../src/services/annoying_service');

function makePlayer(overrides = {}) {
  return {
    lastSelfDisconnectAt: 0,
    lastSelfJoinAt: 0,
    lastSelfJoinChannelId: null,
    currentTrack: { title: '哈基米之歌' },
    joinVoiceChannel: jest.fn().mockResolvedValue(true),
    ...overrides,
  };
}

function makeDeps({ player, capturedState } = {}) {
  const channel = { send: jest.fn().mockResolvedValue({}) };
  const deps = {
    client: {
      user: { id: 'bot-1' },
      channels: { fetch: jest.fn().mockResolvedValue(channel) },
    },
    audioManager: {},
    sessionManager: {
      sessions: new Map([['guild-1', { player, uiContext: { channelId: 'text-1' } }]]),
    },
    radioService: {},
    resumeService: {
      captureGuild: jest.fn().mockReturnValue(capturedState ?? null),
      reconstructGuild: jest.fn().mockResolvedValue(true),
      announceResume: jest.fn().mockResolvedValue(undefined),
    },
  };
  return { deps, channel };
}

function makeService(deps, options = {}) {
  const svc = new AnnoyingService({ exemptUser: 'bk233', rejoinDelayMs: 1500, ...options });
  svc.initialize(deps);
  return svc;
}

const capturedState = () => ({
  guildId: 'guild-1',
  voiceChannelId: 'vc-1',
  textChannelId: 'text-1',
  tracks: [{ title: 'song' }],
});

const oldState = (overrides = {}) => ({
  guild: { id: 'guild-1' },
  channel: { id: 'vc-1' },
  channelId: 'vc-1',
  ...overrides,
});

describe('AnnoyingService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('toggle', () => {
    test('flips the per-guild flag and returns the new state', () => {
      const svc = makeService(makeDeps({}).deps);

      expect(svc.isEnabled('guild-1')).toBe(false);
      expect(svc.toggle('guild-1')).toBe(true);
      expect(svc.isEnabled('guild-1')).toBe(true);
      expect(svc.toggle('guild-1')).toBe(false);
      expect(svc.isEnabled('guild-1')).toBe(false);
    });
  });

  describe('isExemptUser', () => {
    test('matches by id and by username', () => {
      const svc = makeService(makeDeps({}).deps, { exemptUser: 'bk233' });

      expect(svc.isExemptUser({ id: 'bk233', username: 'other' })).toBe(true);
      expect(svc.isExemptUser({ id: '999', username: 'bk233' })).toBe(true);
      expect(svc.isExemptUser({ id: '999', username: 'other' })).toBe(false);
      expect(svc.isExemptUser(null)).toBe(false);
    });

    test('empty config exempts nobody', () => {
      const svc = makeService(makeDeps({}).deps, { exemptUser: '' });
      expect(svc.isExemptUser({ id: 'anyone', username: 'anyone' })).toBe(false);
    });
  });

  describe('isProtectedFrom', () => {
    test('blocks non-exempt users only while the mode is armed', () => {
      const svc = makeService(makeDeps({}).deps, { exemptUser: 'bk233' });

      expect(svc.isProtectedFrom('guild-1', { id: '42', username: 'attacker' })).toBe(false); // off
      svc.enable('guild-1');
      expect(svc.isProtectedFrom('guild-1', { id: '42', username: 'attacker' })).toBe(true);
      expect(svc.isProtectedFrom('guild-1', { id: 'bk233', username: 'whoever' })).toBe(false);
    });

    test('gates nothing when no exempt user is configured (no lockout)', () => {
      const svc = makeService(makeDeps({}).deps, { exemptUser: '' });
      svc.enable('guild-1');
      expect(svc.isProtectedFrom('guild-1', { id: '42', username: 'anyone' })).toBe(false);
    });
  });

  describe('handleBotDisconnect', () => {
    test('ignores when the mode is off', async () => {
      const player = makePlayer();
      const { deps } = makeDeps({ player, capturedState: capturedState() });
      const svc = makeService(deps);

      await expect(svc.handleBotDisconnect(oldState())).resolves.toBe('ignore');
      expect(deps.resumeService.captureGuild).not.toHaveBeenCalled();
    });

    test('ignores our own leave (self-disconnect window)', async () => {
      const player = makePlayer({ lastSelfDisconnectAt: Date.now() });
      const { deps } = makeDeps({ player, capturedState: capturedState() });
      const svc = makeService(deps);
      svc.enable('guild-1');

      await expect(svc.handleBotDisconnect(oldState())).resolves.toBe('ignore');
      expect(deps.resumeService.captureGuild).not.toHaveBeenCalled();
    });

    test('ignores when nothing was playing (no captured state)', async () => {
      const player = makePlayer();
      const { deps } = makeDeps({ player, capturedState: null });
      const svc = makeService(deps);
      svc.enable('guild-1');

      await expect(svc.handleBotDisconnect(oldState())).resolves.toBe('ignore');
      expect(deps.resumeService.reconstructGuild).not.toHaveBeenCalled();
    });

    test('stands down for the exempt user', async () => {
      AuditLog.findRecentAuditExecutor.mockResolvedValue({ id: '999', username: 'bk233' });
      const player = makePlayer();
      const { deps } = makeDeps({ player, capturedState: capturedState() });
      const svc = makeService(deps);
      svc.enable('guild-1');

      await expect(svc.handleBotDisconnect(oldState())).resolves.toBe('exempt');
      jest.advanceTimersByTime(10000);
      expect(deps.resumeService.reconstructGuild).not.toHaveBeenCalled();
    });

    test('reconstructs after a hostile disconnect', async () => {
      AuditLog.findRecentAuditExecutor.mockResolvedValue({ id: '42', username: 'attacker' });
      const player = makePlayer({ lastSelfDisconnectAt: 12345 }); // stale marker
      const { deps, channel } = makeDeps({ player, capturedState: capturedState() });
      const svc = makeService(deps);
      svc.enable('guild-1');

      await expect(svc.handleBotDisconnect(oldState())).resolves.toBe('reconstructing');
      // Snapshot is taken with the event's channel id (joinConfig may be stale).
      expect(deps.resumeService.captureGuild).toHaveBeenCalledWith(
        deps.sessionManager,
        'guild-1',
        'vc-1',
      );
      expect(deps.resumeService.reconstructGuild).not.toHaveBeenCalled(); // delayed

      await jest.advanceTimersByTimeAsync(1500);

      expect(deps.resumeService.reconstructGuild).toHaveBeenCalledWith(
        expect.objectContaining({
          client: deps.client,
          audioManager: deps.audioManager,
          sessionManager: deps.sessionManager,
          radioService: deps.radioService,
        }),
        expect.objectContaining({ guildId: 'guild-1' }),
      );
      // No extra message from the service — the "基米永不灭～" announcement
      // is sent by reconstructGuild (mocked here) itself.
      expect(channel.send).not.toHaveBeenCalled();
      // Marker cleared so the attacker's NEXT kick isn't mistaken for a self-leave.
      expect(player.lastSelfDisconnectAt).toBe(0);
    });

    test('treats an unknown culprit (no audit access) as hostile', async () => {
      AuditLog.findRecentAuditExecutor.mockResolvedValue(null);
      const player = makePlayer();
      const { deps } = makeDeps({ player, capturedState: capturedState() });
      const svc = makeService(deps);
      svc.enable('guild-1');

      await expect(svc.handleBotDisconnect(oldState())).resolves.toBe('reconstructing');
      await jest.advanceTimersByTimeAsync(1500);
      expect(deps.resumeService.reconstructGuild).toHaveBeenCalled();
    });

    test('gives up gracefully when reconstruction fails', async () => {
      AuditLog.findRecentAuditExecutor.mockResolvedValue(null);
      const player = makePlayer();
      const { deps, channel } = makeDeps({ player, capturedState: capturedState() });
      deps.resumeService.reconstructGuild.mockResolvedValue(false);
      const svc = makeService(deps);
      svc.enable('guild-1');

      await svc.handleBotDisconnect(oldState());
      await jest.advanceTimersByTimeAsync(1500);

      expect(channel.send).not.toHaveBeenCalled();
    });
  });

  describe('handleBotMove', () => {
    const movedState = { guild: { id: 'guild-1' }, channel: { id: 'vc-2' }, channelId: 'vc-2' };

    test('ignores our own move (self-join to the landing channel)', async () => {
      const player = makePlayer({ lastSelfJoinAt: Date.now(), lastSelfJoinChannelId: 'vc-2' });
      const { deps } = makeDeps({ player });
      const svc = makeService(deps);
      svc.enable('guild-1');

      await svc.handleBotMove(oldState(), movedState);
      jest.advanceTimersByTime(10000);

      expect(player.joinVoiceChannel).not.toHaveBeenCalled();
      expect(AuditLog.findRecentAuditExecutor).not.toHaveBeenCalled();
    });

    test('a recent self-join to a DIFFERENT channel does not mask a hostile drag', async () => {
      AuditLog.findRecentAuditExecutor.mockResolvedValue(null);
      const player = makePlayer({ lastSelfJoinAt: Date.now(), lastSelfJoinChannelId: 'vc-1' });
      const { deps } = makeDeps({ player });
      const svc = makeService(deps);
      svc.enable('guild-1');

      await svc.handleBotMove(oldState(), movedState);
      await jest.advanceTimersByTimeAsync(1500);

      expect(player.joinVoiceChannel).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'vc-1' }),
      );
    });

    test('respects a move by the exempt user', async () => {
      AuditLog.findRecentAuditExecutor.mockResolvedValue({ id: 'bk233', username: 'whoever' });
      const player = makePlayer();
      const { deps } = makeDeps({ player });
      const svc = makeService(deps);
      svc.enable('guild-1');

      await svc.handleBotMove(oldState(), movedState);
      jest.advanceTimersByTime(10000);

      expect(player.joinVoiceChannel).not.toHaveBeenCalled();
    });

    test('moves back after a hostile drag and announces the revival', async () => {
      AuditLog.findRecentAuditExecutor.mockResolvedValue({ id: '42', username: 'dragger' });
      const player = makePlayer();
      const { deps } = makeDeps({ player });
      const svc = makeService(deps);
      svc.enable('guild-1');

      await svc.handleBotMove(oldState(), movedState);
      expect(player.joinVoiceChannel).not.toHaveBeenCalled(); // delayed

      await jest.advanceTimersByTimeAsync(1500);

      expect(player.joinVoiceChannel).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'vc-1' }),
      );
      // Same "基米永不灭～" message as the other fight-back paths.
      expect(deps.resumeService.announceResume).toHaveBeenCalledWith(
        deps.client,
        'text-1',
        player.currentTrack,
      );
    });

    test('skips the announcement when nothing is playing', async () => {
      AuditLog.findRecentAuditExecutor.mockResolvedValue(null);
      const player = makePlayer({ currentTrack: null });
      const { deps } = makeDeps({ player });
      const svc = makeService(deps);
      svc.enable('guild-1');

      await svc.handleBotMove(oldState(), movedState);
      await jest.advanceTimersByTimeAsync(1500);

      expect(player.joinVoiceChannel).toHaveBeenCalled();
      expect(deps.resumeService.announceResume).not.toHaveBeenCalled();
    });

    test('does nothing when the mode is off', async () => {
      const player = makePlayer();
      const { deps } = makeDeps({ player });
      const svc = makeService(deps);

      await svc.handleBotMove(oldState(), movedState);
      jest.advanceTimersByTime(10000);

      expect(player.joinVoiceChannel).not.toHaveBeenCalled();
    });
  });

  describe('handleBotMuteDeafen', () => {
    function makeVoiceStates({ mute = false, deaf = false } = {}) {
      const voice = {
        setMute: jest.fn().mockResolvedValue(undefined),
        setDeaf: jest.fn().mockResolvedValue(undefined),
      };
      const base = { guild: { id: 'guild-1' }, channel: { id: 'vc-1' }, channelId: 'vc-1' };
      return {
        voice,
        oldVoiceState: { ...base, serverMute: false, serverDeaf: false },
        newVoiceState: { ...base, serverMute: mute, serverDeaf: deaf, member: { voice } },
      };
    }

    test('does nothing when the mode is off', async () => {
      const { voice, oldVoiceState, newVoiceState } = makeVoiceStates({ mute: true });
      const svc = makeService(makeDeps({ player: makePlayer() }).deps);

      await svc.handleBotMuteDeafen(oldVoiceState, newVoiceState);
      jest.advanceTimersByTime(10000);

      expect(voice.setMute).not.toHaveBeenCalled();
    });

    test('ignores events that did not flip the server mute/deaf flags', async () => {
      const { voice, oldVoiceState, newVoiceState } = makeVoiceStates(); // no change
      const svc = makeService(makeDeps({ player: makePlayer() }).deps);
      svc.enable('guild-1');

      await svc.handleBotMuteDeafen(oldVoiceState, newVoiceState);
      jest.advanceTimersByTime(10000);

      expect(voice.setMute).not.toHaveBeenCalled();
      expect(AuditLog.findRecentAuditExecutor).not.toHaveBeenCalled();
    });

    test('stays silenced when the exempt user did it', async () => {
      AuditLog.findRecentAuditExecutor.mockResolvedValue({ id: 'bk233', username: 'whoever' });
      const { voice, oldVoiceState, newVoiceState } = makeVoiceStates({ mute: true });
      const svc = makeService(makeDeps({ player: makePlayer() }).deps);
      svc.enable('guild-1');

      await svc.handleBotMuteDeafen(oldVoiceState, newVoiceState);
      jest.advanceTimersByTime(10000);

      expect(voice.setMute).not.toHaveBeenCalled();
    });

    test('clears a hostile server mute silently (no announcement)', async () => {
      AuditLog.findRecentAuditExecutor.mockResolvedValue({ id: '42', username: 'silencer' });
      const player = makePlayer();
      const { deps } = makeDeps({ player });
      const { voice, oldVoiceState, newVoiceState } = makeVoiceStates({ mute: true });
      const svc = makeService(deps);
      svc.enable('guild-1');

      await svc.handleBotMuteDeafen(oldVoiceState, newVoiceState);
      expect(voice.setMute).not.toHaveBeenCalled(); // delayed

      // Only audit entries that flipped OUR mute/deaf flags count.
      const { entryFilter } = AuditLog.findRecentAuditExecutor.mock.calls[0][2];
      expect(entryFilter({ target: { id: 'bot-1' }, changes: [{ key: 'mute' }] })).toBe(true);
      expect(entryFilter({ target: { id: 'bot-1' }, changes: [{ key: 'nick' }] })).toBe(false);
      expect(entryFilter({ target: { id: 'someone' }, changes: [{ key: 'mute' }] })).toBe(false);

      await jest.advanceTimersByTimeAsync(1500);

      expect(voice.setMute).toHaveBeenCalledWith(false);
      expect(voice.setDeaf).not.toHaveBeenCalled();
      expect(deps.resumeService.announceResume).not.toHaveBeenCalled();
    });

    test('clears mute and deafen together from a single event', async () => {
      AuditLog.findRecentAuditExecutor.mockResolvedValue(null); // unknown ⇒ hostile
      const player = makePlayer({ currentTrack: null });
      const { deps } = makeDeps({ player });
      const { voice, oldVoiceState, newVoiceState } = makeVoiceStates({ mute: true, deaf: true });
      const svc = makeService(deps);
      svc.enable('guild-1');

      await svc.handleBotMuteDeafen(oldVoiceState, newVoiceState);
      await jest.advanceTimersByTimeAsync(1500);

      expect(voice.setMute).toHaveBeenCalledWith(false);
      expect(voice.setDeaf).toHaveBeenCalledWith(false);
      expect(deps.resumeService.announceResume).not.toHaveBeenCalled();
    });

    test('a rapid deafen-then-mute combo clears BOTH flags', async () => {
      // Discord sends mute and deafen as separate gateway events even when
      // toggled together; the second must merge into the scheduled clear,
      // not be dropped (regression: the bot stayed muted forever).
      AuditLog.findRecentAuditExecutor.mockResolvedValue(null);
      const player = makePlayer({ currentTrack: null });
      const { deps } = makeDeps({ player });
      const { voice, oldVoiceState, newVoiceState } = makeVoiceStates({ deaf: true });
      const svc = makeService(deps);
      svc.enable('guild-1');

      // t=0: server deafen
      await svc.handleBotMuteDeafen(oldVoiceState, newVoiceState);
      jest.advanceTimersByTime(500);

      // t=500ms (inside the 1500ms window): server mute lands on top
      await svc.handleBotMuteDeafen(
        { ...oldVoiceState, serverDeaf: true },
        { ...newVoiceState, serverMute: true, serverDeaf: true },
      );

      await jest.advanceTimersByTimeAsync(1500);

      expect(voice.setDeaf).toHaveBeenCalledWith(false);
      expect(voice.setMute).toHaveBeenCalledWith(false);
    });

    test('survives a missing Mute Members permission', async () => {
      AuditLog.findRecentAuditExecutor.mockResolvedValue(null);
      const { deps } = makeDeps({ player: makePlayer() });
      const { voice, oldVoiceState, newVoiceState } = makeVoiceStates({ mute: true });
      voice.setMute.mockRejectedValue(new Error('Missing Permissions'));
      const svc = makeService(deps);
      svc.enable('guild-1');

      await svc.handleBotMuteDeafen(oldVoiceState, newVoiceState);
      await jest.advanceTimersByTimeAsync(1500);

      expect(voice.setMute).toHaveBeenCalled();
      expect(deps.resumeService.announceResume).not.toHaveBeenCalled();

      // The in-flight guard is released, so the next hostile mute is fought.
      await svc.handleBotMuteDeafen(oldVoiceState, newVoiceState);
      await jest.advanceTimersByTimeAsync(1500);
      expect(voice.setMute).toHaveBeenCalledTimes(2);
    });
  });
});
