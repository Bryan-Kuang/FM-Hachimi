import type { ExtractedTrackData, PlayResult } from '../services/types';
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

interface YouTubeExtractorLike {
  extractAudio(
    url: string,
    options?: { priority?: 'foreground' | 'background'; source?: string; onStage?: PlaybackStageReporter },
  ): Promise<ExtractedTrackData>;
  extractAudioFast?(
    url: string,
    options?: { priority?: 'foreground' | 'background'; source?: string; onStage?: PlaybackStageReporter },
  ): Promise<ExtractedTrackData>;
}

interface PlayerServiceLike {
  setUIContext(guildId: string, channelId: string): void;
  notifyState(guildId: string): void;
  playBilibiliVideo(interaction: InteractionLike, url: string, options?: { onStage?: PlaybackStageReporter }): Promise<PlayResult>;
  getYouTubeExtractor(): YouTubeExtractorLike | null;
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
  /** Use the experimental cookie-less fast extraction path (/ytfast). */
  fast?: boolean;
}

function getGuildId(interaction: InteractionLike): string | null {
  return interaction.guild?.id ?? null;
}

function getChannelId(interaction: InteractionLike): string | null {
  return interaction.channelId ?? null;
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
  const guildId = getGuildId(interaction);
  const channelId = getChannelId(interaction);
  if (!guildId || !channelId) {
    return { success: false, error: 'Missing guild or channel context' };
  }

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
  fast,
}: PlayUrlOptions): Promise<CoordinatorResult> {
  const guildId = getGuildId(interaction);
  const channelId = getChannelId(interaction);
  const voiceChannel = interaction.member?.voice?.channel;

  if (!guildId || !channelId) {
    return { success: false, error: 'Missing guild or channel context' };
  }
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

    const useFast = Boolean(fast && ytExtractor.extractAudioFast);

    // Concurrent extract + voice-join (shared with the Bilibili path).
    const ej = await extractAndJoin({
      player,
      voiceChannel: voiceChannel as { id?: string } & Record<string, unknown>,
      onStage,
      logLabel: useFast ? 'YouTube fast playback timing' : 'YouTube direct playback timing',
      logContext: { guildId, userId: interaction.user?.id, url, fast: useFast },
      extract: (stage) => {
        const extractOpts = { priority: 'foreground' as const, source: 'playback', onStage: stage };
        return useFast
          ? ytExtractor.extractAudioFast!(url, extractOpts)
          : ytExtractor.extractAudio(url, extractOpts);
      },
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

/** Experimental: same flow as playYouTubeUrl but via the cookie-less fast pass. */
async function playYouTubeUrlFast(opts: PlayUrlOptions): Promise<CoordinatorResult> {
  return playYouTubeUrl({ ...opts, fast: true });
}

export = {
  playBilibiliUrl,
  playYouTubeUrl,
  playYouTubeUrlFast,
};
