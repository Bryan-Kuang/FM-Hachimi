/**
 * Bulk-enqueue playlist playback. Turns a ResolvedPlaylist (src/playlists/)
 * into a burst of "pending" tracks appended to the queue — each one carries
 * audioUrl: '' and an epoch extractedAt so the lazy-extraction seam in
 * src/audio/audio_player.ts (playCurrentTrack) does the real yt-dlp/native
 * extraction only when that track is actually about to play. This keeps
 * enqueueing a 100-item playlist fast (no network calls in the loop) instead
 * of extracting every item up front.
 */

import type { ExtractedTrackData } from '../services/types';
import type { PlaylistItem, ResolvedPlaylist } from '../playlists/types';

/** Same Chrome UA used by every extractor in this repo (bilibili/extractor.ts, youtube/extractor.ts). */
const CHROME_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Build the "pending" ExtractedTrackData for one playlist item. No real
 * extraction happens here — audioUrl is deliberately empty and extractedAt is
 * pinned to the Unix epoch so Track.isExpired() is always true, which makes
 * playCurrentTrack() refresh (i.e. actually extract) the real stream URL the
 * moment this track is about to play.
 */
export function buildPendingTrackData(item: PlaylistItem): ExtractedTrackData {
  // Pseudo-URLs (ytsearch1:...) resolved lazily from Spotify items aren't
  // real links — keep them out of the `url` field so nothing renders them as
  // a clickable link in the UI.
  const isPseudoUrl = item.url.startsWith('ytsearch');

  return {
    title: item.title,
    audioUrl: '',
    duration: item.durationSec,
    platform: item.platform,
    normalizedUrl: item.url,
    originalUrl: item.url,
    url: isPseudoUrl ? undefined : item.url,
    // Epoch → Track.isExpired() is always true → play-time refresh always
    // fires. Do not change this to `new Date().toISOString()` — that would
    // silently disable lazy extraction for up to urlRefreshThreshold (20 min).
    extractedAt: new Date(0).toISOString(),
    streamHeaders: item.platform === 'youtube'
      ? { referer: 'https://www.youtube.com/', userAgent: CHROME_USER_AGENT }
      : undefined,
    thumbnail: item.thumbnail,
    author: item.author,
  };
}

// ─── playPlaylist ───────────────────────────────────────────────────────

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
  queue: { items: unknown[] };
  joinVoiceChannel(channel: unknown): Promise<boolean>;
}

interface RadioServiceLike {
  isEnabled(guildId: string): boolean;
}

interface PlayerServiceLike {
  setUIContext(guildId: string, channelId: string): void;
  notifyState(guildId: string): void;
  getRadioService?(): RadioServiceLike | null;
  getPlayer(guildId: string): PlayerLike;
  addTrack(guildId: string, videoData: ExtractedTrackData, requestedBy: string): Promise<unknown>;
  playTrackAt(guildId: string, index: number): Promise<boolean>;
}

export interface PlayPlaylistResult {
  success: boolean;
  error?: string;
  queued: number;
  title: string;
  truncated: boolean;
  totalCount: number;
}

export interface PlayPlaylistOptions {
  interaction: InteractionLike;
  playerService: PlayerServiceLike;
  playlist: ResolvedPlaylist;
  requestedBy?: string;
  onProgress?: (queued: number, total: number) => void;
}

function getRequestedBy(interaction: InteractionLike, requestedBy?: string): string {
  if (requestedBy) return requestedBy;
  return interaction.user?.id ? `<@${interaction.user.id}>` : 'Unknown';
}

const PROGRESS_REPORT_EVERY = 10;

export async function playPlaylist({
  interaction,
  playerService,
  playlist,
  requestedBy,
  onProgress,
}: PlayPlaylistOptions): Promise<PlayPlaylistResult> {
  const emptyResult = (error: string): PlayPlaylistResult => ({
    success: false,
    error,
    queued: 0,
    title: playlist.title,
    truncated: playlist.truncated,
    totalCount: playlist.totalCount,
  });

  const guildId = interaction.guild?.id;
  const channelId = interaction.channelId;
  if (!guildId || !channelId) {
    return emptyResult('Missing guild or channel context');
  }

  const voiceChannel = interaction.member?.voice?.channel as ({ id?: string } & Record<string, unknown>) | undefined;
  if (!voiceChannel) {
    return emptyResult('Voice channel required');
  }

  // Radio owns the queue while enabled — a bulk-enqueued playlist would be
  // silently discarded on the next radio advance. Refuse up front.
  const radio = playerService.getRadioService?.();
  if (radio?.isEnabled(guildId)) {
    return emptyResult('RADIO_ACTIVE');
  }

  if (playlist.items.length === 0) {
    return emptyResult('歌单为空或全部曲目不可用');
  }

  playerService.setUIContext(guildId, channelId);

  const player = playerService.getPlayer(guildId);
  const needsVoiceJoin =
    !player.voiceConnection || player.voiceConnection.joinConfig?.channelId !== voiceChannel.id;
  if (needsVoiceJoin) {
    const joined = await player.joinVoiceChannel(voiceChannel);
    if (!joined) {
      return emptyResult('Failed to join voice channel');
    }
  }

  const startIndex = player.queue.items.length;
  const wasActive = player.isPlaying || player.isPaused;
  const requester = getRequestedBy(interaction, requestedBy);

  let queued = 0;
  const total = playlist.items.length;
  for (let i = 0; i < total; i++) {
    const track = await playerService.addTrack(guildId, buildPendingTrackData(playlist.items[i]), requester);
    if (track) queued++;

    const isLast = i === total - 1;
    if (onProgress && ((i + 1) % PROGRESS_REPORT_EVERY === 0 || isLast)) {
      onProgress(i + 1, total);
    }
  }

  if (queued === 0) {
    return emptyResult('歌单为空或全部曲目不可用');
  }

  if (!wasActive) {
    await playerService.playTrackAt(guildId, startIndex);
  } else {
    playerService.notifyState(guildId);
  }

  return {
    success: true,
    queued,
    title: playlist.title,
    truncated: playlist.truncated,
    totalCount: playlist.totalCount,
  };
}
