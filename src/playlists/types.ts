/**
 * Playlist domain types — shared between the per-source resolvers
 * (youtube_playlist_resolver, bilibili_playlist_resolver,
 * spotify_playlist_resolver) and the bulk-enqueue coordinator
 * (src/playback/playlist_coordinator.ts).
 */

export interface PlaylistItem {
  /** Canonical per-item URL → becomes Track.normalizedUrl. Spotify items use a lazy `ytsearch1:<artist> <title>` pseudo-URL. */
  url: string;
  title: string;
  /** 0 = unknown */
  durationSec: number;
  platform: 'bilibili' | 'youtube';
  author?: string;
  thumbnail?: string;
}

export interface ResolvedPlaylist {
  kind:
    | 'youtube-playlist'
    | 'bilibili-fav'
    | 'bilibili-collection'
    | 'bilibili-multipart'
    | 'spotify-album'
    | 'spotify-playlist';
  title: string;
  items: PlaylistItem[];
  totalCount: number;
  truncated: boolean;
}

export type PlaylistProgress = (fetched: number, total?: number) => void;
