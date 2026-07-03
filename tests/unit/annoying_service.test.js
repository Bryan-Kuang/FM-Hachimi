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
    joinVoiceChannel: jest.fn().mockResolvedValue(true),
    ...overrides,
  };
}

function makeDeps({ player, capturedState } = {}) {
  const channel = { send: jest.fn().mockResolvedValue({}) };
  const deps = {
    client: { channels: { fetch: jest.fn().mockResolvedValue(channel) } },
    audioManager: {},
    sessionManager: {
      sessions: new Map([['guild-1', { player, uiContext: { channelId: 'text-1' } }]]),
    },
    radioService: {},
    resumeService: {
      captureGuild: jest.fn().mockReturnValue(capturedState ?? null),
      reconstructGuild: jest.fn().mockResolvedValue(true),
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

    test('moves back after a hostile drag and taunts', async () => {
      AuditLog.findRecentAuditExecutor.mockResolvedValue({ id: '42', username: 'dragger' });
      const player = makePlayer();
      const { deps, channel } = makeDeps({ player });
      const svc = makeService(deps);
      svc.enable('guild-1');

      await svc.handleBotMove(oldState(), movedState);
      expect(player.joinVoiceChannel).not.toHaveBeenCalled(); // delayed

      await jest.advanceTimersByTimeAsync(1500);

      expect(player.joinVoiceChannel).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'vc-1' }),
      );
      expect(channel.send).toHaveBeenCalledWith(expect.stringContaining('dragger'));
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
});
