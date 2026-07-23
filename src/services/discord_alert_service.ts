/**
 * Discord error alerting — posts error-level log entries to a Discord webhook
 * so runtime failures surface in a channel instead of only in `docker logs`.
 *
 * Guard rails (load-bearing — see tests):
 * - Opt-in: disabled unless ERROR_WEBHOOK_URL is set.
 * - Dedupe: at most one alert per unique message within DEDUPE_WINDOW_MS.
 * - Hard cap: at most MAX_PER_MINUTE alerts per minute across all messages.
 * - Fire-and-forget: never throws, never re-enters the logger — a webhook
 *   failure must not produce an error log that triggers another webhook call.
 */

import axios from 'axios';

const DEDUPE_WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_MINUTE = 5;
const MAX_CONTENT_LENGTH = 1900; // Discord's limit is 2000
const KEY_MAP_PRUNE_SIZE = 500;

type PostFn = (url: string, body: { content: string }) => Promise<unknown>;

const defaultPost: PostFn = (url, body) => axios.post(url, body, { timeout: 5000 });

class DiscordErrorAlerter {
  private readonly webhookUrl: string;
  private readonly post: PostFn;
  private readonly lastSentByKey = new Map<string, number>();
  private minuteWindowStart = 0;
  private minuteCount = 0;

  constructor(webhookUrl: string, post: PostFn = defaultPost) {
    this.webhookUrl = webhookUrl;
    this.post = post;
  }

  get enabled(): boolean {
    return this.webhookUrl.length > 0;
  }

  report(message: string, context?: Record<string, unknown>): void {
    if (!this.enabled) return;
    try {
      const now = Date.now();

      const lastSent = this.lastSentByKey.get(message);
      if (lastSent !== undefined && now - lastSent < DEDUPE_WINDOW_MS) return;

      if (now - this.minuteWindowStart >= 60_000) {
        this.minuteWindowStart = now;
        this.minuteCount = 0;
      }
      if (this.minuteCount >= MAX_PER_MINUTE) return;
      this.minuteCount++;

      this.lastSentByKey.set(message, now);
      if (this.lastSentByKey.size > KEY_MAP_PRUNE_SIZE) {
        for (const [key, sentAt] of this.lastSentByKey) {
          if (now - sentAt >= DEDUPE_WINDOW_MS) this.lastSentByKey.delete(key);
        }
      }

      let content = `🚨 **${message}**`;
      if (context && Object.keys(context).length > 0) {
        let ctx: string;
        try {
          ctx = JSON.stringify(context);
        } catch {
          ctx = '[unserializable context]';
        }
        content += `\n\`\`\`json\n${ctx}\n\`\`\``;
      }
      if (content.length > MAX_CONTENT_LENGTH) {
        content = `${content.slice(0, MAX_CONTENT_LENGTH - 4)}\n…\``;
      }

      // Swallow webhook failures silently: routing them through the logger
      // would recurse right back here.
      this.post(this.webhookUrl, { content }).catch(() => { /* intentionally silent */ });
    } catch {
      /* alerting must never break the caller */
    }
  }
}

const alerter = new DiscordErrorAlerter(process.env.ERROR_WEBHOOK_URL || '');

export = { DiscordErrorAlerter, alerter };
