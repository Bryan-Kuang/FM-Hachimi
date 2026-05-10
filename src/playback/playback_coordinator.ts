import type { ExtractedTrackData, PlayResult } from '../services/types';
import * as logger from '../services/logger_service';

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
  extractAudio(url: string): Promise<ExtractedTrackData>;
}

interface PlayerServiceLike {
  setUIContext(guildId: string, channelId: string): void;
  notifyState(guildId: string): void;
  playBilibiliVideo(interaction: InteractionLike, url: string): Promise<PlayResult>;
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
}

interface PlayExtractedOptions {
  interaction: InteractionLike;
  playerService: PlayerServiceLike;
  videoData: ExtractedTrackData;
  requestedBy?: string;
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
}: PlayUrlOptions): Promise<CoordinatorResult> {
  const guildId = getGuildId(interaction);
  const channelId = getChannelId(interaction);
  if (!guildId || !channelId) {
    return { success: false, error: 'Missing guild or channel context' };
  }

  playerService.setUIContext(guildId, channelId);
  const result = await playerService.playBilibiliVideo(interaction, url);

  if (result.success) {
    playerService.notifyState(guildId);
  }

  return result as CoordinatorResult;
}

async function playExtractedTrack({
  interaction,
  playerService,
  videoData,
  requestedBy,
}: PlayExtractedOptions): Promise<CoordinatorResult> {
  const guildId = getGuildId(interaction);
  const channelId = getChannelId(interaction);
  const voiceChannel = interaction.member?.voice?.channel;

  if (!guildId || !channelId) {
    return { success: false, error: 'Missing guild or channel context' };
  }
  if (!voiceChannel) {
    return { success: false, error: 'Voice channel required' };
  }

  const player = playerService.getPlayer(guildId);
  const joined = await player.joinVoiceChannel(voiceChannel);
  if (!joined) {
    return { success: false, error: 'Failed to join voice channel' };
  }

  const track = await playerService.addTrack(guildId, videoData, getRequestedBy(interaction, requestedBy));
  if (!track) {
    return { success: false, error: 'Failed to add track to queue' };
  }

  playerService.setUIContext(guildId, channelId);
  if (!player.isPlaying && !player.isPaused) {
    await playerService.play(guildId);
  } else {
    playerService.notifyState(guildId);
  }

  return { success: true, track, videoData };
}

async function playYouTubeUrl({
  interaction,
  playerService,
  url,
  requestedBy,
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
    const player = playerService.getPlayer(guildId);
    const totalStartedAt = Date.now();
    const timings: Record<string, number> = {};
    const markTotal = () => {
      timings.totalMs = Date.now() - totalStartedAt;
    };
    const logTiming = (success: boolean, extra: Record<string, unknown> = {}) => {
      markTotal();
      logger.info('YouTube direct playback timing', {
        guildId,
        userId: interaction.user?.id,
        url,
        success,
        ...timings,
        ...extra,
      });
    };
    const timed = async <T>(stage: string, promise: Promise<T>): Promise<T> => {
      const startedAt = Date.now();
      try {
        return await promise;
      } finally {
        timings[stage] = Date.now() - startedAt;
      }
    };
    const settle = async <T>(
      promise: Promise<T>,
    ): Promise<{ ok: true; value: T } | { ok: false; error: Error }> => {
      try {
        return { ok: true, value: await promise };
      } catch (error: unknown) {
        return { ok: false, error: error as Error };
      }
    };

    const wasActiveBeforeCommand = Boolean(player.isPlaying || player.isPaused);
    const hadVoiceConnectionBeforeCommand = Boolean(player.voiceConnection);
    const targetChannelId = (voiceChannel as { id?: string }).id;
    const needsVoiceJoin =
      !player.voiceConnection ||
      player.voiceConnection.joinConfig?.channelId !== targetChannelId;

    const extractionPromise = timed('extractionMs', ytExtractor.extractAudio(url));
    const joinPromise = needsVoiceJoin
      ? timed('voiceJoinMs', player.joinVoiceChannel(voiceChannel))
      : Promise.resolve(true);

    const [extractionResult, joinResult] = await Promise.all([
      settle(extractionPromise),
      settle(joinPromise),
    ]);

    if (!extractionResult.ok) {
      if (
        joinResult.ok &&
        joinResult.value &&
        needsVoiceJoin &&
        !wasActiveBeforeCommand &&
        !hadVoiceConnectionBeforeCommand
      ) {
        player.leaveVoiceChannel?.();
      }
      logTiming(false, { failedStage: 'extraction' });
      return { success: false, error: extractionResult.error.message };
    }

    if (!joinResult.ok || !joinResult.value) {
      logTiming(false, { failedStage: 'voiceJoin' });
      return { success: false, error: 'Failed to join voice channel' };
    }

    const queueStartedAt = Date.now();
    const videoData = extractionResult.value;
    const track = await playerService.addTrack(guildId, videoData, getRequestedBy(interaction, requestedBy));
    timings.queueAddMs = Date.now() - queueStartedAt;
    if (!track) {
      logTiming(false, { failedStage: 'queueAdd' });
      return { success: false, error: 'Failed to add track to queue' };
    }

    playerService.setUIContext(guildId, channelId);
    if (!player.isPlaying && !player.isPaused) {
      const playbackStartedAt = Date.now();
      const playSuccess = await playerService.play(guildId);
      timings.playbackStartMs = Date.now() - playbackStartedAt;
      if (!playSuccess) {
        logTiming(false, { failedStage: 'playbackStart' });
        return { success: false, error: 'Failed to start playback' };
      }
    } else {
      playerService.notifyState(guildId);
    }

    logTiming(true);
    return { success: true, track, videoData };
  } catch (error: unknown) {
    return { success: false, error: (error as Error).message };
  }
}

export = {
  playBilibiliUrl,
  playExtractedTrack,
  playYouTubeUrl,
};
