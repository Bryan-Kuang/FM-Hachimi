import alertModule = require('../../../src/services/discord_alert_service');

const { DiscordErrorAlerter } = alertModule;

describe('DiscordErrorAlerter', () => {
  const WEBHOOK = 'https://discord.com/api/webhooks/test';

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-22T00:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('disabled when no webhook url — never calls post', () => {
    const post = jest.fn().mockResolvedValue(undefined);
    const alerter = new DiscordErrorAlerter('', post);

    expect(alerter.enabled).toBe(false);
    alerter.report('boom');
    expect(post).not.toHaveBeenCalled();
  });

  test('posts a formatted alert when enabled', () => {
    const post = jest.fn().mockResolvedValue(undefined);
    const alerter = new DiscordErrorAlerter(WEBHOOK, post);

    alerter.report('extraction failed', { url: 'x' });

    expect(post).toHaveBeenCalledTimes(1);
    const [url, body] = post.mock.calls[0];
    expect(url).toBe(WEBHOOK);
    expect(body.content).toContain('extraction failed');
    expect(body.content).toContain('"url":"x"');
  });

  test('dedupes the same message within the 10-minute window', () => {
    const post = jest.fn().mockResolvedValue(undefined);
    const alerter = new DiscordErrorAlerter(WEBHOOK, post);

    alerter.report('same error');
    jest.advanceTimersByTime(9 * 60 * 1000);
    alerter.report('same error'); // still within window → suppressed
    expect(post).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(2 * 60 * 1000); // now past 10 min
    alerter.report('same error');
    expect(post).toHaveBeenCalledTimes(2);
  });

  test('hard-caps at 5 distinct messages per minute', () => {
    const post = jest.fn().mockResolvedValue(undefined);
    const alerter = new DiscordErrorAlerter(WEBHOOK, post);

    for (let i = 0; i < 8; i++) alerter.report(`error ${i}`);
    expect(post).toHaveBeenCalledTimes(5);

    jest.advanceTimersByTime(61 * 1000); // new minute window
    alerter.report('error after window');
    expect(post).toHaveBeenCalledTimes(6);
  });

  test('never throws when post rejects — failures are swallowed (no recursion)', () => {
    const post = jest.fn().mockRejectedValue(new Error('webhook down'));
    const alerter = new DiscordErrorAlerter(WEBHOOK, post);

    expect(() => alerter.report('boom')).not.toThrow();
    expect(post).toHaveBeenCalledTimes(1);
  });

  test('never throws when post itself throws synchronously', () => {
    const post = jest.fn(() => { throw new Error('sync throw'); });
    const alerter = new DiscordErrorAlerter(WEBHOOK, post);

    expect(() => alerter.report('boom')).not.toThrow();
  });
});
