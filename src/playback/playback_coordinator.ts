import type { ExtractedTrackData, PlayResult } from '../services/types';

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
  joinVoiceChannel(channel: unknown): Promise<boolean>;
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
  const ytExtractor = playerService.getYouTubeExtractor();
  if (!ytExtractor) {
    return {
      success: false,
      error: 'YouTube extractor is not available.',
      suggestion: 'Please try again later.',
    };
  }

  try {
    const videoData = await ytExtractor.extractAudio(url);
    return await playExtractedTrack({ interaction, playerService, videoData, requestedBy });
  } catch (error: unknown) {
    return { success: false, error: (error as Error).message };
  }
}

export = {
  playBilibiliUrl,
  playExtractedTrack,
  playYouTubeUrl,
};
