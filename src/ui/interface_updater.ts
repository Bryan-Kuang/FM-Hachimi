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

  constructor(
    sessionManager: SessionManager,
    progressTracker: ProgressTracker,
    audioManager: AudioManager,
  ) {
    this.client = null;
    this.sessionManager = sessionManager;
    this.progressTracker = progressTracker;
    this.audioManager = audioManager;
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
        },
      );
      const components = ButtonBuilders.createPlaybackControls({
        isPlaying: state.isPlaying,
        hasQueue: state.queueLength > 0,
        canGoBack: state.hasPrevious,
        canSkip: state.hasNext,
        loopMode: state.loopMode,
      });
      const options = { embeds: [embed], components };

      if (ctx.messageId) {
        try {
          const msg = await channel.messages.edit(ctx.messageId, options);
          if (!msg) throw new Error('Message edit returned null');
          if ((session.uiSeq || 0) !== s) return;
          if (state.isPlaying && state.currentTrack) {
            this.progressTracker.startTracking(guildId, msg as unknown as Parameters<ProgressTracker['startTracking']>[1], () => this._getPlayerState(guildId));
          } else {
            this.progressTracker.stopTracking(guildId);
          }
        } catch (_e: unknown) {
          // Disable buttons on stale message to prevent ghost interactions
          try {
            await channel.messages.edit(ctx.messageId, { components: [] });
          } catch (_) { /* message may already be deleted */ }
          const sent = await channel.send(options);
          session.uiContext = { channelId: ctx.channelId, messageId: sent.id };
          if (state.isPlaying && state.currentTrack) {
            this.progressTracker.startTracking(guildId, sent as unknown as Parameters<ProgressTracker['startTracking']>[1], () => this._getPlayerState(guildId));
          } else {
            this.progressTracker.stopTracking(guildId);
          }
        }
      } else {
        const sent = await channel.send(options);
        session.uiContext = { channelId: ctx.channelId, messageId: sent.id };
        if (state.isPlaying && state.currentTrack) {
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
   * Get current player state for progress tracking.
   */
  _getPlayerState(guildId: string): PlayerState | null {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const player: any = this.audioManager.getPlayer(guildId);
    if (!player) return null;
    return {
      currentTrack: player.currentTrack,
      isPlaying: player.isPlaying,
      currentTime: player.getCurrentTime(),
      currentIndex: player.currentIndex,
      queueLength: player.queue ? player.queue.length : 0,
      loopMode: player.loopMode,
      hasPrevious: player.canGoBack(),
      hasNext: player.canSkip(),
    };
  }
}

export = InterfaceUpdater;
