jest.mock('../../src/services/logger_service', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
const VoiceRecoveryService = require('../../src/services/voice_recovery_service');

function setup() {
  const state = { guildId: 'g', voiceChannelId: 'v', tracks: [{ title: 'song' }], positionSeconds: 42, isPaused: true, radioMode: true };
  const player = {
    voiceIntentRevision: 1, intendedVoiceChannelId: 'v',
    voiceConnection: { state: { status: 'ready' } },
    prepareVoiceRecovery: jest.fn(),
  };
  const rest = jest.fn().mockResolvedValue({ channel_id: 'v' });
  const deps = {
    client: { rest: { get: rest }, isReady: () => true },
    sessionManager: { sessions: new Map([['g', { player }]]) },
    audioManager: {}, radioService: { stop: jest.fn().mockResolvedValue() },
    resumeService: { captureGuild: () => state, reconstructGuild: jest.fn().mockResolvedValue(true) },
  };
  const service = new VoiceRecoveryService(deps);
  return { service, deps, player, rest, state };
}
const missing = { code: 10065, status: 404 };
describe('authoritative voice recovery', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  test('silent loss with local ready is debounced, rebuilt and verified', async () => {
    const { service, deps, rest, player, state } = setup();
    rest.mockRejectedValueOnce(missing).mockRejectedValueOnce(missing);
    await service.check();
    expect(player.prepareVoiceRecovery).not.toHaveBeenCalled();
    await service.check();
    expect(player.prepareVoiceRecovery).toHaveBeenCalledTimes(1);
    expect(deps.resumeService.reconstructGuild).toHaveBeenCalledWith(expect.objectContaining({ recoveryIsCurrent: expect.any(Function) }), state);
    expect(service.getHealth().healthy).toBe(true);
    service.stop();
  });
  test.each([{ status: 500 }, { status: 429 }, new Error('timeout')])('uncertain REST error never destroys working voice: %p', async error => {
    const { service, rest, player } = setup();
    rest.mockRejectedValue(error);
    await service.check(); await service.check();
    expect(player.prepareVoiceRecovery).not.toHaveBeenCalled();
    service.stop();
  });
  test('concurrent checks serialize per guild', async () => {
    const { service, rest } = setup();
    let resolve;
    rest.mockImplementation(() => new Promise(r => { resolve = r; }));
    const first = service.check();
    await service.check();
    expect(rest).toHaveBeenCalledTimes(1);
    resolve({ channel_id: 'v' }); await first;
    service.stop();
  });
  test('failed reconstruction retains original snapshot and retries with backoff', async () => {
    const { service, deps, state } = setup();
    deps.resumeService.reconstructGuild.mockResolvedValueOnce(false);
    service.request(state);
    await jest.advanceTimersByTimeAsync(1500);
    expect(service.getHealth().healthy).toBe(false);
    expect(service.getPendingSnapshots()).toEqual([state]);
    await jest.advanceTimersByTimeAsync(5000);
    expect(deps.resumeService.reconstructGuild).toHaveBeenCalledTimes(2);
    expect(service.getPendingSnapshots()).toEqual([]);
    service.stop();
  });
  test('successful local restore with missing membership is not success', async () => {
    const { service, rest, state } = setup();
    rest.mockRejectedValue(missing);
    service.request(state);
    await jest.advanceTimersByTimeAsync(1500);
    expect(service.getHealth().healthy).toBe(false);
    expect(service.getPendingSnapshots()).toEqual([state]);
    service.stop();
  });
  test('stop or a new join cancels delayed recovery', async () => {
    const { service, deps, state, player } = setup();
    service.request(state);
    player.voiceIntentRevision++;
    player.intendedVoiceChannelId = null;
    await jest.advanceTimersByTimeAsync(10000);
    expect(deps.resumeService.reconstructGuild).not.toHaveBeenCalled();
    expect(service.getPendingSnapshots()).toEqual([]);
    service.stop();
  });
  test('cancellation while restoring invalidates the callback', async () => {
    const { service, deps, state, player } = setup();
    let guard;
    deps.resumeService.reconstructGuild.mockImplementation(async d => { guard = d.recoveryIsCurrent; player.voiceIntentRevision++; return false; });
    service.request(state);
    await jest.advanceTimersByTimeAsync(10000);
    expect(guard()).toBe(false);
    expect(deps.resumeService.reconstructGuild).toHaveBeenCalledTimes(1);
    service.stop();
  });
  test('healthy actual membership never triggers a rebuild', async () => {
    const { service, player } = setup();
    await service.check(); await service.check();
    expect(player.prepareVoiceRecovery).not.toHaveBeenCalled();
    service.stop();
  });
  test('membership alone is insufficient when the local transport remains disconnected', async () => {
    const { service, deps, player } = setup();
    player.voiceConnection.state.status = 'disconnected';
    await service.check(); await service.check();
    expect(deps.resumeService.reconstructGuild).toHaveBeenCalledTimes(1);
    service.stop();
  });
  test('moderation policy can decline a silent recovery', async () => {
    const { service, deps, rest, player } = setup();
    deps.shouldRecover = async () => false;
    rest.mockRejectedValue(missing);
    await service.check(); await service.check();
    expect(player.prepareVoiceRecovery).not.toHaveBeenCalled();
    service.stop();
  });
  test('an authorized removal during reconstruction cancels subsequent retries', async () => {
    const { service, deps, rest, state } = setup();
    rest.mockRejectedValue(missing);
    deps.shouldRecover = async () => false;
    service.request(state); await jest.advanceTimersByTimeAsync(120000);
    expect(deps.resumeService.reconstructGuild).toHaveBeenCalledTimes(1);
    expect(service.getPendingSnapshots()).toEqual([]);
    service.stop();
  });
  test('REST outage after local restoration only retries verification', async () => {
    const { service, deps, rest, state, player } = setup();
    rest.mockRejectedValueOnce({ status: 503 });
    service.request(state);
    await jest.advanceTimersByTimeAsync(1500);
    expect(player.prepareVoiceRecovery).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(5000);
    expect(deps.resumeService.reconstructGuild).toHaveBeenCalledTimes(1);
    expect(service.getHealth().healthy).toBe(true);
    service.stop();
  });
  test('successful restore guard remains valid for late Playing/pause event', async () => {
    const { service, deps, state } = setup();
    service.request(state); await jest.advanceTimersByTimeAsync(1500);
    const guard = deps.resumeService.reconstructGuild.mock.calls[0][0].recoveryIsCurrent;
    expect(guard()).toBe(true);
    service.stop(); expect(guard()).toBe(false);
  });
  test('definitive deleted channel stops retrying but retains failed snapshot', async () => {
    const { service, deps, state } = setup();
    deps.client.channels = { fetch: jest.fn().mockRejectedValue({ code: 10003 }) };
    service.request(state); await jest.advanceTimersByTimeAsync(120000);
    expect(deps.client.channels.fetch).toHaveBeenCalledTimes(1);
    expect(service.getHealth().healthy).toBe(false);
    expect(service.getPendingSnapshots()).toEqual([state]);
    service.stop();
  });
});
