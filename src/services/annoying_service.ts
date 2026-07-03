/**
 * AnnoyingService — /annoying 反谋害模式 (anti-disconnect mode)
 *
 * While enabled for a guild, the bot refuses to be removed from its voice
 * channel: a forced disconnect triggers a full session reconstruction (the
 * ResumeService restore path — rejoin, re-seek, re-pause, re-arm radio) a
 * moment later, and a forced channel move is countered by moving back. The one
 * exception is the exempt user (config.annoying.exemptUser, injected via the
 * ANNOYING_EXEMPT_USER secret), whose disconnects/moves are respected.
 *
 * Self-initiated leaves and moves (idle auto-disconnect, /stop, /play joining
 * another channel, our own counter-move) are recognized via the AudioPlayer's
 * lastSelfDisconnectAt / lastSelfJoinAt markers and never fought — otherwise
 * the bot would loop against itself.
 *
 * Exempting requires the View Audit Log permission; without it the culprit is
 * unknown and treated as hostile (escape hatch: /annoying again to turn off).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { AuditLogEvent } from 'discord.js';
import * as logger from './logger_service';
import AuditLog = require('../utils/audit_log');

/** Bot-left events this close to our own _doDisconnect() are voluntary. */
const SELF_DISCONNECT_WINDOW_MS = 3000;
/** Bot-moved events this close to our own joinVoiceChannel() are voluntary. */
const SELF_MOVE_WINDOW_MS = 10000;

interface AnnoyingOptions {
  /** Discord user (numeric id or username) allowed to remove the bot. */
  exemptUser: string;
  /** Delay before fighting back — also the spam-disconnect rate limiter. */
  rejoinDelayMs: number;
}

interface AnnoyingDeps {
  client: any;          // discord.js Client
  audioManager: any;    // AudioManager — RestoreDeps for reconstruction
  sessionManager: any;  // SessionManager
  radioService?: any;   // RadioService — re-armed by the restore path
  resumeService: any;   // ResumeService — capture + reconstruct machinery
}

type DisconnectOutcome = 'ignore' | 'exempt' | 'reconstructing';

class AnnoyingService {
  private readonly options: AnnoyingOptions;
  private deps: AnnoyingDeps | null;
  private readonly enabledGuilds: Set<string>;
  /** Guilds with a fight-back in flight — guards double reconstruction. */
  private readonly busyGuilds: Set<string>;

  constructor(options: AnnoyingOptions) {
    this.options = options;
    this.deps = null;
    this.enabledGuilds = new Set();
    this.busyGuilds = new Set();
  }

  initialize(deps: AnnoyingDeps): void {
    this.deps = deps;
  }

  isEnabled(guildId: string): boolean {
    return this.enabledGuilds.has(guildId);
  }

  enable(guildId: string): void {
    this.enabledGuilds.add(guildId);
  }

  disable(guildId: string): void {
    this.enabledGuilds.delete(guildId);
  }

  /** Flip the flag; returns the new state. */
  toggle(guildId: string): boolean {
    if (this.isEnabled(guildId)) {
      this.disable(guildId);
      return false;
    }
    this.enable(guildId);
    return true;
  }

  /** Empty exemptUser config means nobody is exempt. */
  isExemptUser(user: { id?: string; username?: string } | null | undefined): boolean {
    const exempt = this.options.exemptUser;
    if (!exempt || !user) return false;
    return user.id === exempt || user.username === exempt;
  }

  /**
   * Bot was disconnected from voice (channel → null). Called by the
   * voiceStateUpdate handler BEFORE teardown, because teardown
   * (leaveVoiceChannel) wipes the queue this captures.
   *
   * Returns what the caller should do: 'ignore'/'exempt' → proceed exactly as
   * today (teardown + murder message); 'reconstructing' → still tear down, but
   * skip the murder message (we rejoin and send our own taunt).
   */
  async handleBotDisconnect(oldState: any): Promise<DisconnectOutcome> {
    const deps = this.deps;
    const guildId: string | undefined = oldState?.guild?.id;
    if (!deps || !guildId || !this.isEnabled(guildId)) return 'ignore';
    if (this.busyGuilds.has(guildId)) return 'ignore';

    const player = deps.sessionManager.sessions?.get(guildId)?.player;
    if (!player) return 'ignore';
    if (Date.now() - (player.lastSelfDisconnectAt || 0) < SELF_DISCONNECT_WINDOW_MS) {
      return 'ignore'; // our own leave (idle timeout, /stop, shutdown)
    }

    // Snapshot the live session before the caller's teardown destroys it. The
    // event's channel id overrides joinConfig, which may already be stale.
    const state = deps.resumeService.captureGuild(deps.sessionManager, guildId, oldState.channelId);
    if (!state) return 'ignore'; // nothing playing — not worth fighting over

    const culprit = await AuditLog.findRecentAuditExecutor(
      oldState.guild,
      AuditLogEvent.MemberDisconnect,
    );
    if (this.isExemptUser(culprit)) {
      logger.info('Annoying mode: disconnect by exempt user, standing down', {
        guildId,
        culprit: culprit?.username,
      });
      return 'exempt';
    }

    const culpritName = culprit?.displayName || culprit?.username || '未知凶手';
    this.busyGuilds.add(guildId);
    setTimeout(() => {
      this.reconstruct(state, culpritName)
        .catch((err: Error) => {
          logger.error('Annoying mode: reconstruction failed', {
            guildId,
            error: err.message,
          });
        })
        .finally(() => this.busyGuilds.delete(guildId));
    }, this.options.rejoinDelayMs);

    logger.info('Annoying mode: hostile disconnect, reconstruction scheduled', {
      guildId,
      culprit: culpritName,
      delayMs: this.options.rejoinDelayMs,
    });
    return 'reconstructing';
  }

  /**
   * Bot was moved between voice channels. The voice connection survives a
   * move (audio keeps playing), so no state restore is needed — just move
   * back unless the move was our own doing or the exempt user's.
   */
  async handleBotMove(oldState: any, newState: any): Promise<void> {
    const deps = this.deps;
    const guildId: string | undefined = oldState?.guild?.id;
    if (!deps || !guildId || !this.isEnabled(guildId)) return;

    const session = deps.sessionManager.sessions?.get(guildId);
    const player = session?.player;
    if (!player || !oldState.channel) return;

    // Self-move: we just joined the channel this event lands in (e.g. /play
    // from another channel, or our own counter-move). A move to a DIFFERENT
    // channel is hostile even inside the window.
    if (
      Date.now() - (player.lastSelfJoinAt || 0) < SELF_MOVE_WINDOW_MS &&
      player.lastSelfJoinChannelId === newState.channelId
    ) {
      return;
    }

    const culprit = await AuditLog.findRecentAuditExecutor(
      oldState.guild,
      AuditLogEvent.MemberMove,
    );
    if (this.isExemptUser(culprit)) {
      logger.info('Annoying mode: move by exempt user, staying put', {
        guildId,
        culprit: culprit?.username,
      });
      return;
    }
    if (this.busyGuilds.has(guildId)) return;

    const targetChannel = oldState.channel;
    const culpritName = culprit?.displayName || culprit?.username || '未知黑手';
    this.busyGuilds.add(guildId);
    setTimeout(() => {
      (async () => {
        const moved = await player.joinVoiceChannel(targetChannel);
        if (!moved) {
          logger.warn('Annoying mode: failed to move back', { guildId });
          return;
        }
        logger.info('Annoying mode: moved back after hostile drag', {
          guildId,
          channelId: targetChannel.id,
          culprit: culpritName,
        });
        await this.sendTaunt(
          session?.uiContext?.channelId ?? null,
          `🐱 **${culpritName}** 想把基米拖走？基米自己走回来了喵～`,
        );
      })()
        .catch((err: Error) => {
          logger.error('Annoying mode: move-back failed', { guildId, error: err.message });
        })
        .finally(() => this.busyGuilds.delete(guildId));
    }, this.options.rejoinDelayMs);
  }

  private async reconstruct(state: any, culpritName: string): Promise<void> {
    const deps = this.deps!;

    const restored = await deps.resumeService.reconstructGuild(
      {
        client: deps.client,
        audioManager: deps.audioManager,
        sessionManager: deps.sessionManager,
        radioService: deps.radioService,
      },
      state,
    );
    if (!restored) {
      // Channel gone / empty / join denied — the normal teardown already ran,
      // so losing this round gracefully is fine.
      logger.info('Annoying mode: reconstruction skipped or failed, giving up', {
        guildId: state.guildId,
      });
      return;
    }

    // Our own teardown stamped lastSelfDisconnectAt; clear it so the
    // attacker's NEXT kick isn't mistaken for a self-leave.
    const player = deps.sessionManager.sessions?.get(state.guildId)?.player;
    if (player) player.lastSelfDisconnectAt = 0;

    await this.sendTaunt(
      state.textChannelId,
      `😾 **${culpritName}** 妄图谋害基米？没用的喵～ 基米回来了，继续唱！`,
    );
  }

  private async sendTaunt(channelId: string | null, message: string): Promise<void> {
    if (!channelId) return;
    const deps = this.deps;
    if (!deps) return;
    try {
      const channel: any = await deps.client.channels.fetch(channelId).catch(() => null);
      if (!channel || typeof channel.send !== 'function') return;
      await channel.send(message);
    } catch (err: unknown) {
      logger.debug('Annoying mode: failed to send taunt', {
        error: (err as Error).message,
      });
    }
  }
}

export = AnnoyingService;
