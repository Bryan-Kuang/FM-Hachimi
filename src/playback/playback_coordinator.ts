import type { AudioExtractorLike, ExtractedTrackData, PlayResult } from '../services/types';
import { emitPlaybackStage, type PlaybackStageReporter } from './stage_feedback';
import { extractAndJoin } from './extract_join';

interface GuildLike {
  id: string;
}

interface UserLike {
  id: string;
}

interface InteractionLike {
  guild?: GuildLike | null;
  channelId?: string;
  user?: UserLike;
  member?: {
    voice?: {
      channel?: unknown;
    };
  } | null;
}

interface PlayerLike {
  isPlaying: boolean;
  isPaused: boolean;
  voiceConnection?: {
    joinConfig?: {
      channelId?: string;
    };
  } | null;
  joinVoiceChannel(channel: unknown): Promise<boolean>;
  leaveVoiceChannel?(): void;
}

interface RadioServiceLike {
  isEnabled(guildId: string): boolean;
  playNow?(
    guildId: string,
    url: string,
    requestedBy: string,
    platform?: PlayUrlPlatform,
  ): Promise<{ success: boolean; error?: string; track?: unknown }>;
}

interface PlayerServiceLike {
  setUIContext(guildId: string, channelId: string): void;
  notifyState(guildId: string): void;
  getRadioService?(): RadioServiceLike | null;
  playBilibiliVideo(interaction: InteractionLike, url: string, options?: { onStage?: PlaybackStageReporter }): Promise<PlayResult>;
  getYouTubeExtractor(): AudioExtractorLike | null;
  getPlayer(guildId: string): PlayerLike;
  addTrack(guildId: string, videoData: ExtractedTrackData, requestedBy: string): Promise<unknown>;
  play(guildId: string): Promise<boolean>;
}

interface CoordinatorResult {
  success: boolean;
  error?: string;
  suggestion?: string;
  track?: unknown;
  videoData?: ExtractedTrackData;
}

interface PlayUrlOptions {
  interaction: InteractionLike;
  playerService: PlayerServiceLike;
  url: string;
  requestedBy?: string;
  onStage?: PlaybackStageReporter;
}

type PlayUrlPlatform = 'bilibili' | 'youtube';

/** Shared prologue: both paths need a guild + channel to do anything. */
function getPlaybackContext(
  interaction: InteractionLike,
): { guildId: string; channelId: string } | null {
  const guildId = interaction.guild?.id ?? null;
  const channelId = interaction.channelId ?? null;
  return guildId && channelId ? { guildId, channelId } : null;
}

function getRequestedBy(interaction: InteractionLike, requestedBy?: string): string {
  if (requestedBy) return requestedBy;
  return interaction.user?.id ? `<@${interaction.user.id}>` : 'Unknown';
}

async function playBilibiliUrl({
  interaction,
  playerService,
  url,
  onStage,
}: PlayUrlOptions): Promise<CoordinatorResult> {
  const ctx = getPlaybackContext(interaction);
  if (!ctx) {
    return { success: false, error: 'Missing guild or channel context' };
  }
  const { guildId, channelId } = ctx;

  playerService.setUIContext(guildId, channelId);
  const result = onStage
    ? await playerService.playBilibiliVideo(interaction, url, { onStage })
    : await playerService.playBilibiliVideo(interaction, url);

  if (result.success) {
    playerService.notifyState(guildId);
  }

  return result as CoordinatorResult;
}

async function playYouTubeUrl({
  interaction,
  playerService,
  url,
  requestedBy,
  onStage,
}: PlayUrlOptions): Promise<CoordinatorResult> {
  const ctx = getPlaybackContext(interaction);
  const voiceChannel = interaction.member?.voice?.channel;

  if (!ctx) {
    return { success: false, error: 'Missing guild or channel context' };
  }
  const { guildId, channelId } = ctx;
  if (!voiceChannel) {
    return { success: false, error: 'Voice channel required' };
  }

  const ytExtractor = playerService.getYouTubeExtractor();
  if (!ytExtractor) {
    return {
      success: false,
      error: 'YouTube extractor is not available.',
      suggestion: 'Please try again later.',
    };
  }

  try {
    const reportStage = (
      stage: Parameters<typeof emitPlaybackStage>[1],
      details?: Parameters<typeof emitPlaybackStage>[2],
    ) => {
      emitPlaybackStage(onStage, stage, details);
    };

    const player = playerService.getPlayer(guildId);

    // Concurrent extract + voice-join (shared with the Bilibili path).
    const ej = await extractAndJoin({
      player,
      voiceChannel: voiceChannel as { id?: string } & Record<string, unknown>,
      onStage,
      logLabel: 'YouTube direct playback timing',
      logContext: { guildId, userId: interaction.user?.id, url },
      extract: (stage) => ytExtractor.extractAudio(url, {
        priority: 'foreground',
        source: 'playback',
        onStage: stage,
      }),
    });

    if (!ej.ok) {
      return {
        success: false,
        error: ej.failedStage === 'voiceJoin' ? 'Failed to join voice channel' : ej.error,
      };
    }

    const { videoData, timings, logTiming } = ej;

    const queueStartedAt = Date.now();
    const track = await playerService.addTrack(guildId, videoData, getRequestedBy(interaction, requestedBy));
    timings.queueAddMs = Date.now() - queueStartedAt;
    if (!track) {
      reportStage('failed', { stage: 'queueAdd' });
      logTiming(false, { failedStage: 'queueAdd' });
      return { success: false, error: 'Failed to add track to queue' };
    }
    reportStage('queued');

    playerService.setUIContext(guildId, channelId);
    if (!player.isPlaying && !player.isPaused) {
      const playbackStartedAt = Date.now();
      reportStage('starting_playback');
      const playSuccess = await playerService.play(guildId);
      timings.playbackStartMs = Date.now() - playbackStartedAt;
      if (!playSuccess) {
        reportStage('failed', { stage: 'playbackStart' });
        logTiming(false, { failedStage: 'playbackStart' });
        return { success: false, error: 'Failed to start playback' };
      }
      reportStage('playing');
    } else {
      playerService.notifyState(guildId);
      reportStage('playing');
    }

    logTiming(true);
    return { success: true, track, videoData };
  } catch (error: unknown) {
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Single entry point: dispatches to the platform path. Prefer this over the
 * per-platform functions (kept exported for existing tests/back-compat).
 * Full convergence of the two paths onto extractAndJoin is the deferred
 * playback-core consolidation (TASKS.md Phase 2) — not done here.
 */
async function playUrl(
  platform: PlayUrlPlatform,
  options: PlayUrlOptions,
): Promise<CoordinatorResult> {
  // While radio is running, the rotation owns the queue — a normally-queued
  // track would be discarded on the next advance. Interject the request into
  // the rotation instead (same path as the daily recommendation): it plays now
  // and the radio resumes when it ends.
  const radioResult = await maybePlayAsRadioInterlude(platform, options);
  if (radioResult) return radioResult;

  return platform === 'youtube' ? playYouTubeUrl(options) : playBilibiliUrl(options);
}

/**
 * If radio mode is active for this guild, interject the requested video via
 * RadioService.playNow so it plays immediately and the rotation resumes after.
 * Returns the interlude result, or null when radio is off (fall through to the
 * normal queue path).
 */
async function maybePlayAsRadioInterlude(
  platform: PlayUrlPlatform,
  options: PlayUrlOptions,
): Promise<CoordinatorResult | null> {
  const { interaction, playerService, url, requestedBy } = options;
  const guildId = interaction.guild?.id;
  if (!guildId) return null;

  const radio = playerService.getRadioService?.();
  if (!radio || !radio.isEnabled(guildId) || typeof radio.playNow !== 'function') {
    return null;
  }

  const channelId = interaction.channelId;
  if (channelId) playerService.setUIContext(guildId, channelId);

  const result = await radio.playNow(
    guildId,
    url,
    getRequestedBy(interaction, requestedBy),
    platform,
  );
  return {
    success: result.success,
    error: result.error,
    track: result.track,
  };
}

export = {
  playUrl,
  playBilibiliUrl,
  playYouTubeUrl,
};
