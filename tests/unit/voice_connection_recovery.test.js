jest.mock('../../src/services/logger_service', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
const { EventEmitter } = require('events');
const AudioPlayer = require('../../src/audio/audio_player');
const voice = require('@discordjs/voice');
function connection(status = 'connecting') {
  const c = new EventEmitter();
  c.state = { status }; c.joinConfig = { channelId: 'v' };
  c.subscribe = jest.fn(); c.destroy = jest.fn(() => { c.state.status = 'destroyed'; c.emit('destroyed'); });
  return c;
}
describe('voice connection lifecycle', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  test('wait removes only its own listeners', async () => {
    const p = new AudioPlayer(); const c = connection(); p.voiceConnection = c;
    const monitor = jest.fn(); c.on('disconnected', monitor);
    const waiting = p.waitForVoiceConnection(); c.emit('ready'); await waiting;
    c.emit('disconnected'); expect(monitor).toHaveBeenCalledTimes(1);
  });
  test('timeout cleans listeners on the original connection', async () => {
    const p = new AudioPlayer(); const c = connection(); p.voiceConnection = c;
    const waiting = p.waitForVoiceConnection().catch(e => e);
    p.voiceConnection = connection();
    await jest.advanceTimersByTimeAsync(60000);
    expect((await waiting).message).toMatch(/timeout/);
    expect(c.listenerCount('ready')).toBe(0);
    expect(c.listenerCount('disconnected')).toBe(0);
  });
  test('recovery teardown destroys even ready connections but preserves intent', () => {
    const p = new AudioPlayer(); const c = connection('ready'); p.voiceConnection = c;
    p.intendedVoiceChannelId = 'v'; const revision = p.voiceIntentRevision;
    p.prepareVoiceRecovery();
    expect(c.destroy).toHaveBeenCalled();
    expect(p.voiceConnection).toBeNull();
    expect(p.intendedVoiceChannelId).toBe('v');
    expect(p.voiceIntentRevision).toBe(revision);
    p.leaveVoiceChannel(); expect(p.intendedVoiceChannelId).toBeNull();
    expect(p.voiceIntentRevision).toBeGreaterThan(revision);
  });
  test('stop cancels recovery intent', async () => {
    const p = new AudioPlayer(); p.intendedVoiceChannelId = 'v'; const revision = p.voiceIntentRevision;
    await p.stop(); expect(p.intendedVoiceChannelId).toBeNull();
    expect(p.voiceIntentRevision).toBeGreaterThan(revision);
  });
  test('recovery invalidates extraction already running in the old player', async () => {
    const p = new AudioPlayer(); p.voiceConnection = connection('ready');
    p.currentTrack = { title: 'old', normalizedUrl: 'u', audioUrl: 'old-url', isExpired: () => true };
    let resolve;
    p.getRefreshExtractor = () => ({ getAudioStreamUrl: () => new Promise(r => { resolve = r; }) });
    p.createAudioResource = jest.fn();
    const oldPlayback = p.playCurrentTrack();
    p.prepareVoiceRecovery(); resolve('new-url');
    expect(await oldPlayback).toBe(false);
    expect(p.createAudioResource).not.toHaveBeenCalled();
  });
  test('an already cancelled restore cannot join', async () => {
    const p = new AudioPlayer(); voice.joinVoiceChannel.mockClear();
    expect(await p.joinVoiceChannel({ id: 'v', guild: { id: 'g' } }, 0, () => false)).toBe(false);
    expect(voice.joinVoiceChannel).not.toHaveBeenCalled();
  });
});
