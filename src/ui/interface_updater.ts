import EmbedBuilders = require('./embeds');
import ButtonBuilders = require('./buttons');
import * as logger from '../services/logger_service';
import SessionManager = require('../session/session_manager');
import ProgressTracker = require('./progress_tracker');
import AudioManager = require('../session/audio_manager');
import type { PlayerState } from '../types';

// Minimal Discord channel shape needed here.
interface DiscordMessage {
  id: string;
}
interface DiscordChannel {
  messages: {
    edit(messageId: string, options: unknown): Promise<DiscordMessage>;
    delete(messageId: string): Promise<void>;
  };
  send(options: unknown): Promise<DiscordMessage>;
}
interface DiscordClient {
  channels: {
    cache: { get(id: string): DiscordChannel | undefined };
    fetch(id: string): Promise<DiscordChannel>;
  };
}

// PlayerControl duck type — only the subset used by InterfaceUpdater
interface PlayerControlLike {
  onStateChanged(handler: (event: { guildId: string; state: PlayerState }) => Promise<void>): void;
}

class InterfaceUpdater {
  private client: DiscordClient | null;
  private sessionManager: SessionManager;
  private progressTracker: ProgressTracker;
  private audioManager: AudioManager;
  /** Last repost time per guild — throttles the first-listener repost. */
  private lastRepostAt: Map<string, number>;
  private readonly repostCooldownMs = 10_000;

  constructor(
    sessionManager: SessionManager,
    progressTracker: ProgressTracker,
    audioManager: AudioManager,
  ) {
    this.client = null;
    this.sessionManager = sessionManager;
    this.progressTracker = progressTracker;
    this.audioManager = audioManager;
    this.lastRepostAt = new Map();
  }

  setClient(client: DiscordClient): void {
    this.client = client;
  }

  setPlaybackContext(guildId: string, channelId: string, messageId: string | null): void {
    const session = this.sessionManager.get(guildId);
    const prev = session.uiContext ?? {};
    session.uiContext = {
      channelId,
      messageId: messageId ?? (prev as { messageId?: string }).messageId ?? '',
    };
  }

  clearContext(guildId: string): void {
    const session = this.sessionManager.get(guildId);
    session.uiContext = null;
    session.uiSeq = 0;
  }

  /**
   * Check whether a UI context exists for a guild.
   */
  hasContext(guildId: string): boolean {
    const session = this.sessionManager.get(guildId);
    return session.uiContext != null;
  }

  /**
   * Get the UI context for a guild.
   */
  getContext(guildId: string): { channelId: string; messageId: string } | null {
    return this.sessionManager.get(guildId).uiContext as { channelId: string; messageId: string } | null;
  }

  bind(playerControl: PlayerControlLike): void {
    playerControl.onStateChanged(async ({ guildId, state }) => {
      await this.handleUpdate(guildId, state);
    });
  }

  async handleUpdate(guildId: string, state: PlayerState): Promise<void> {
    try {
      const session = this.sessionManager.get(guildId);
      const s = (session.uiSeq || 0) + 1;
      session.uiSeq = s;
      const ctx = session.uiContext;
      if (!ctx || !ctx.channelId) return;
      if (!state.currentTrack) {
        this.progressTracker.stopTracking(guildId);
        return;
      }
      // Capture to local variable to prevent race condition during async ops
      const currentTrack = state.currentTrack;
      const client = this.client;
      if (!client) return;
      const channel = (client.channels.cache.get(ctx.channelId) ??
        await client.channels.fetch(ctx.channelId)) as DiscordChannel;
      const currentTime = (this.audioManager.getPlayer(guildId) as { getCurrentTime(): number }).getCurrentTime();
      const embed = EmbedBuilders.createNowPlayingEmbed(
        currentTrack as unknown as Parameters<typeof EmbedBuilders.createNowPlayingEmbed>[0],
        {
          currentTime,
          requestedBy: currentTrack.requestedBy as string | undefined,
          queuePosition: (state.currentIndex >= 0 ? state.currentIndex + 1 : 0),
          totalQueue: state.queueLength,
          loopMode: state.loopMode,
          radioMode: state.radioMode,
          isBreak: state.isBreak,
        },
      );
      const components = ButtonBuilders.createPlaybackControls({
        isPlaying: state.isPlaying,
        hasQueue: state.queueLength > 0,
        canGoBack: state.hasPrevious,
        canSkip: state.hasNext,
        loopMode: state.loopMode,
        radioMode: state.radioMode,
      });
      const options = { embeds: [embed], components };
      // The break card is intentionally static (title only) — no per-second
      // progress edits.
      const shouldTrackProgress = Boolean(state.currentTrack && !state.isPaused && !state.isBreak);

      if (ctx.messageId) {
        try {
          const msg = await channel.messages.edit(ctx.messageId, options);
          if (!msg) throw new Error('Message edit returned null');
          if ((session.uiSeq || 0) !== s) return;
          if (shouldTrackProgress) {
            this.progressTracker.startTracking(guildId, msg as unknown as Parameters<ProgressTracker['startTracking']>[1], () => this._getPlayerState(guildId));
          } else {
            this.progressTracker.stopTracking(guildId);
          }
        } catch (e: unknown) {
          if (state.radioMode) {
            logger.warn('Radio play card edit failed; keeping existing card context', {
              guildId,
              messageId: ctx.messageId,
              error: (e as Error).message,
            });
            this.progressTracker.stopTracking(guildId);
            return;
          }
          // Disable buttons on stale message to prevent ghost interactions
          try {
            await channel.messages.edit(ctx.messageId, { components: [] });
          } catch (_) { /* message may already be deleted */ }
          // Stale-check before sending: a newer handleUpdate() may have already
          // sent its own message. If so, let it own the new messageId instead
          // of sending a duplicate.
          if ((session.uiSeq || 0) !== s) return;
          const sent = await channel.send(options);
          session.uiContext = { channelId: ctx.channelId, messageId: sent.id };
          if (shouldTrackProgress) {
            this.progressTracker.startTracking(guildId, sent as unknown as Parameters<ProgressTracker['startTracking']>[1], () => this._getPlayerState(guildId));
          } else {
            this.progressTracker.stopTracking(guildId);
          }
        }
      } else {
        // Stale-check: if another handleUpdate() incremented uiSeq past s while
        // we were awaiting the channel fetch above, that newer call is responsible
        // for sending the initial message. Returning here prevents two concurrent
        // "no messageId" calls from both reaching channel.send() and creating
        // duplicate play cards.
        if ((session.uiSeq || 0) !== s) return;
        const sent = await channel.send(options);
        session.uiContext = { channelId: ctx.channelId, messageId: sent.id };
        if (shouldTrackProgress) {
          this.progressTracker.startTracking(guildId, sent as unknown as Parameters<ProgressTracker['startTracking']>[1], () => this._getPlayerState(guildId));
        } else {
          this.progressTracker.stopTracking(guildId);
        }
      }
    } catch (e: unknown) {
      logger.error('Interface update failed', { guildId, error: (e as Error).message });
    }
  }

  /**
   * Repost the now-playing card to the bottom of the text channel. Called when
   * the first listener joins a channel the bot has been playing to alone, so a
   * card buried under later chat becomes reachable again. Deletes the old card
   * and lets handleUpdate() send a fresh one (delete-and-repost). No-op when no
   * live card exists, nothing is playing, or the guild is inside the cooldown.
   */
  async repostNowPlaying(guildId: string): Promise<void> {
    const now = Date.now();
    const last = this.lastRepostAt.get(guildId) ?? 0;
    if (now - last < this.repostCooldownMs) return;

    const session = this.sessionManager.get(guildId);
    const ctx = session.uiContext as { channelId: string; messageId: string } | null;
    if (!ctx || !ctx.channelId || !ctx.messageId) return; // no live card to move

    const state = this._getPlayerState(guildId);
    if (!state || !state.currentTrack) return; // nothing playing to advertise

    const client = this.client;
    if (!client) return;

    this.lastRepostAt.set(guildId, now);

    try {
      const channel = (client.channels.cache.get(ctx.channelId) ??
        await client.channels.fetch(ctx.channelId)) as DiscordChannel;
      // Best-effort delete of the buried card; it may already be gone.
      const oldMessageId = ctx.messageId;
      try {
        await channel.messages.delete(oldMessageId);
      } catch (_) { /* already deleted */ }
      // Drop the messageId so handleUpdate() takes the send-fresh path and
      // repoints uiContext at the new message.
      session.uiContext = { channelId: ctx.channelId, messageId: '' };
      await this.handleUpdate(guildId, state);
    } catch (e: unknown) {
      logger.error('Now-playing card repost failed', { guildId, error: (e as Error).message });
    }
  }

  /**
   * Get current player state for progress tracking.
   */
  _getPlayerState(guildId: string): PlayerState | null {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const player: any = this.audioManager.getPlayer(guildId);
    if (!player) return null;
    return {
      currentTrack: player.currentTrack,
      isPlaying: player.isPlaying,
      isPaused: player.isPaused,
      currentTime: player.getCurrentTime(),
      currentIndex: player.currentIndex,
      queueLength: player.queue ? player.queue.length : 0,  // queue.length works on both Queue class and raw array
      loopMode: player.loopMode,
      radioMode: player.radioMode,
      isBreak: player.radioBreak,
      hasPrevious: player.canGoBack(),
      hasNext: player.canSkip(),
    };
  }
}

export = InterfaceUpdater;
