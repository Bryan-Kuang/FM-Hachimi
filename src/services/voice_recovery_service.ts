/* eslint-disable @typescript-eslint/no-explicit-any */
import logger = require('./logger_service');
import metrics = require('../observability/metrics');

interface RecoveryDeps {
  client: any;
  sessionManager: any;
  audioManager: any;
  radioService?: any;
  resumeService: any;
  isBusy?: (guildId: string) => boolean;
  shouldRecover?: (guildId: string, actual: string | null) => Promise<boolean>;
}
interface Pending {
  state: any;
  player: any;
  revision: number;
  attempts: number;
  terminal: boolean;
  cancelled?: boolean;
  awaitingVerification?: boolean;
  timer?: ReturnType<typeof setTimeout>;
}
interface Observation {
  expectedChannelId: string;
  actualChannelId: string | null;
  lastVerifiedAt: number;
  mismatches: number;
  localStatus?: string;
  error?: string;
}

/** Membership is authoritative; an advancing local player is not proof of it. */
class VoiceRecoveryService {
  private pending = new Map<string, Pending>();
  private checking = new Set<string>();
  private observations = new Map<string, Observation>();
  private timer?: ReturnType<typeof setInterval>;
  private stopped = false;

  constructor(private readonly deps: RecoveryDeps) {}

  start(): void {
    if (this.timer) return;
    this.stopped = false;
    this.timer = setInterval(() => { void this.check(); }, 30000);
    this.timer.unref?.();
  }

  stop(): void {
    this.stopped = true;
    clearInterval(this.timer);
    this.timer = undefined;
    for (const entry of this.pending.values()) clearTimeout(entry.timer);
    this.pending.clear();
  }

  isRecovering(guildId: string): boolean { return this.pending.has(guildId); }

  cancel(guildId: string): void {
    const entry = this.pending.get(guildId);
    if (entry) entry.cancelled = true;
    clearTimeout(entry?.timer);
    metrics.gauge('voice_recovery_pending').set(0, { guildId });
    metrics.gauge('voice_membership_mismatch').set(0, { guildId });
    this.pending.delete(guildId);
    this.observations.delete(guildId);
  }

  private current(entry: Pending): boolean {
    return this.pending.get(entry.state.guildId) === entry && this.validIntent(entry);
  }

  private validIntent(entry: Pending): boolean {
    return !this.stopped && !entry.cancelled &&
      this.deps.sessionManager.sessions.get(entry.state.guildId)?.player === entry.player &&
      entry.player.voiceIntentRevision === entry.revision &&
      entry.player.intendedVoiceChannelId === entry.state.voiceChannelId;
  }

  getPendingSnapshots(): any[] {
    return [...this.pending.values()].filter(entry => this.current(entry)).map(entry => entry.state);
  }

  getHealth(): { healthy: boolean; sessions: Record<string, unknown>[] } {
    const sessions: Record<string, unknown>[] = [];
    for (const [guildId, entry] of this.pending) {
      if (!this.current(entry)) { this.cancel(guildId); continue; }
      sessions.push({ guildId, expectedChannelId: entry.state.voiceChannelId, ...this.observations.get(guildId), recovering: !entry.terminal,
        failed: entry.terminal, attempts: entry.attempts, degraded: true });
    }
    for (const [guildId, observation] of this.observations) {
      if (this.pending.has(guildId)) continue;
      const player = this.deps.sessionManager.sessions.get(guildId)?.player;
      if (player?.intendedVoiceChannelId !== observation.expectedChannelId) continue;
      sessions.push({ guildId, ...observation, degraded: observation.mismatches >= 2 });
    }
    return { healthy: !sessions.some(s => s.degraded), sessions };
  }

  request(state: any, delayMs = 1500): void {
    if (this.stopped || this.pending.has(state.guildId)) return;
    const player = this.deps.sessionManager.sessions.get(state.guildId)?.player;
    if (!player || player.intendedVoiceChannelId !== state.voiceChannelId) return;
    const entry: Pending = { state, player, revision: player.voiceIntentRevision, attempts: 0, terminal: false };
    this.pending.set(state.guildId, entry);
    metrics.gauge('voice_recovery_pending').set(1, { guildId: state.guildId });
    // Snapshot must precede this teardown; it stops empty playback immediately.
    void this.deps.radioService?.stop(state.guildId).catch((err: Error) => {
      logger.warn('Failed to suspend radio for voice recovery', { guildId: state.guildId, error: err.message });
    });
    player.prepareVoiceRecovery();
    this.schedule(entry, delayMs);
  }

  private schedule(entry: Pending, delayMs: number): void {
    entry.timer = setTimeout(() => { void this.attempt(entry); }, delayMs);
    entry.timer.unref?.();
  }

  private async membership(guildId: string): Promise<string | null> {
    try {
      const state = await this.deps.client.rest.get(`/guilds/${guildId}/voice-states/@me`,
        { signal: AbortSignal.timeout(10000) });
      return state.channel_id ?? null;
    } catch (err: unknown) {
      if ((err as { code?: number }).code === 10065) return null;
      throw err;
    }
  }

  async check(): Promise<void> {
    if (this.stopped || !this.deps.client.isReady()) return;
    for (const [guildId, session] of this.deps.sessionManager.sessions) {
      const player = session.player;
      const target = player?.intendedVoiceChannelId;
      if (!target || this.pending.has(guildId) || this.checking.has(guildId) || this.deps.isBusy?.(guildId)) continue;
      this.checking.add(guildId);
      const revision = player.voiceIntentRevision;
      try {
        const actual = await this.membership(guildId);
        if (this.stopped || player.voiceIntentRevision !== revision || this.pending.has(guildId) || this.deps.isBusy?.(guildId)) continue;
        const previous = this.observations.get(guildId);
        const localStatus = player.voiceConnection?.state.status ?? 'missing';
        const mismatches = actual === target && localStatus === 'ready' ? 0 : (previous && previous.expectedChannelId === target ? previous.mismatches : 0) + 1;
        metrics.gauge('voice_membership_last_verified_timestamp_seconds').set(Date.now() / 1000, { guildId });
        metrics.gauge('voice_membership_mismatch').set(mismatches >= 2 ? 1 : 0, { guildId });
        this.observations.set(guildId, { expectedChannelId: target, actualChannelId: actual,
          lastVerifiedAt: Date.now(), mismatches, localStatus });
        if (mismatches >= 2) {
          if (this.deps.shouldRecover && !await this.deps.shouldRecover(guildId, actual)) continue;
          if (player.voiceIntentRevision !== revision || this.stopped || this.pending.has(guildId)) continue;
          const state = this.deps.resumeService.captureGuild(this.deps.sessionManager, guildId, target);
          if (!state) continue;
          logger.warn('Voice membership mismatch; reconstructing session', { guildId, expected: target, actual, localStatus });
          this.request(state, 0);
          const entry = this.pending.get(guildId);
          if (entry) { clearTimeout(entry.timer); await this.attempt(entry); }
        }
      } catch (err: unknown) {
        // REST's rate limiter honors retry-after; transport errors are not absence.
        logger.warn('Voice membership verification unavailable', { guildId, error: (err as Error).message });
      } finally {
        this.checking.delete(guildId);
      }
    }
  }

  private async attempt(entry: Pending): Promise<void> {
    const guildId = entry.state.guildId;
    if (!this.current(entry)) { if (this.pending.get(guildId) === entry) this.cancel(guildId); return; }
    if (!this.deps.client.isReady()) { this.schedule(entry, 5000); return; }
    entry.attempts++;
    metrics.counter('voice_recovery_attempts_total').inc({ guildId });
    try {
      if (!entry.awaitingVerification) {
        const channel = await this.deps.client.channels?.fetch(entry.state.voiceChannelId);
        if (!this.current(entry)) return;
        const permissions = channel?.permissionsFor?.(this.deps.client.user);
        if (permissions && !permissions.has(['ViewChannel', 'Connect', 'Speak'])) {
          entry.terminal = true;
          logger.error('Voice recovery blocked by channel permissions', { guildId });
          return;
        }
        await this.deps.radioService?.stop(guildId);
        if (!this.current(entry)) return;
        entry.awaitingVerification = await this.deps.resumeService.reconstructGuild({ ...this.deps,
          recoveryIsCurrent: () => this.validIntent(entry) }, entry.state);
        if (!this.current(entry)) return;
      }
      {
        const actual = await this.membership(guildId);
        if (!this.current(entry)) return;
        if (entry.awaitingVerification && actual && actual === entry.state.voiceChannelId) {
          this.observations.set(guildId, { expectedChannelId: actual, actualChannelId: actual,
            lastVerifiedAt: Date.now(), mismatches: 0 });
          entry.player.lastSelfDisconnectAt = 0;
          this.pending.delete(guildId);
          metrics.gauge('voice_recovery_pending').set(0, { guildId });
          metrics.gauge('voice_membership_mismatch').set(0, { guildId });
          metrics.counter('voice_recovery_success_total').inc({ guildId });
          logger.info('Voice membership verified after recovery', { guildId, attempts: entry.attempts });
          return;
        }
        if (actual !== entry.state.voiceChannelId && this.deps.shouldRecover &&
            !await this.deps.shouldRecover(guildId, actual)) {
          if (this.pending.get(guildId) === entry) this.cancel(guildId);
          return;
        }
        entry.awaitingVerification = false;
      }
    } catch (err: unknown) {
      const code = (err as { code?: number }).code;
      entry.terminal = code === 10003 || code === 50001 || code === 50013;
      logger.warn('Voice recovery attempt failed', { guildId, attempt: entry.attempts,
        terminal: entry.terminal, error: (err as Error).message });
    } finally {
      if (!this.current(entry) && this.pending.get(guildId) === entry) this.cancel(guildId);
    }
    if (this.current(entry) && !entry.terminal) {
      if (!entry.awaitingVerification) entry.player.prepareVoiceRecovery();
      logger.warn('Voice recovery awaiting retry', { guildId, attempts: entry.attempts, verifying: !!entry.awaitingVerification });
      this.schedule(entry, Math.min(60000, 5000 * 2 ** Math.min(entry.attempts - 1, 4)));
    }
  }
}

export = VoiceRecoveryService;
