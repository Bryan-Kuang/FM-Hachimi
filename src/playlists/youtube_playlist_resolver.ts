/**
 * YouTube playlist → ResolvedPlaylist. A single yt-dlp flat-playlist listing
 * call (no per-page pagination needed — yt-dlp handles that internally via
 * --playlist-end).
 */

import type { ResolvedPlaylist, PlaylistItem } from './types';

interface YtFlatPlaylistEntryLike {
  id: string;
  title: string;
  duration: number;
  uploader: string;
  url: string;
}

interface YouTubeExtractorLike {
  listPlaylistItems(playlistUrl: string, limit: number): Promise<{
    success: boolean;
    playlistTitle?: string;
    entries?: YtFlatPlaylistEntryLike[];
    error?: string;
  }>;
}

export interface ResolveYouTubePlaylistOptions {
  listId: string;
  youtubeExtractor: YouTubeExtractorLike;
  maxItems: number;
}

export async function resolveYouTubePlaylist({
  listId,
  youtubeExtractor,
  maxItems,
}: ResolveYouTubePlaylistOptions): Promise<ResolvedPlaylist> {
  const result = await youtubeExtractor.listPlaylistItems(
    `https://www.youtube.com/playlist?list=${listId}`,
    maxItems,
  );

  if (!result.success) {
    throw new Error(result.error || 'Failed to list YouTube playlist');
  }

  const entries = result.entries ?? [];
  const items: PlaylistItem[] = entries.map((entry) => ({
    url: entry.url,
    title: entry.title,
    durationSec: entry.duration || 0,
    platform: 'youtube',
    author: entry.uploader,
  }));

  return {
    kind: 'youtube-playlist',
    title: result.playlistTitle || 'YouTube Playlist',
    items,
    // yt-dlp's --playlist-end caps the listing itself; we only know entries
    // actually returned, so totalCount is a best-effort lower bound and
    // truncated is true when we hit the cap exactly (likely more exist).
    totalCount: items.length,
    truncated: items.length >= maxItems,
  };
}
