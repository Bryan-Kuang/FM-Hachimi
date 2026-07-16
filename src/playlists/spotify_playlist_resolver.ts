/**
 * Spotify album/playlist → ResolvedPlaylist. Spotify never serves audio
 * directly, so every item becomes a lazy `ytsearch1:` pseudo-URL resolved at
 * play time (see src/spotify/resolver.ts buildLazySearchUrl and the
 * playCurrentTrack refresh seam in src/audio/audio_player.ts).
 */

import { buildLazySearchUrl } from '../spotify/resolver';
import type { ResolvedPlaylist, PlaylistItem } from './types';

interface SpotifyTrackMetaLike {
  title: string;
  artists: string[];
  durationSec: number;
  albumName?: string;
  thumbnail?: string;
}

interface SpotifyCollectionLike {
  name: string;
  total: number;
  tracks: SpotifyTrackMetaLike[];
}

interface SpotifyClientLike {
  getAlbum(id: string, maxItems: number): Promise<SpotifyCollectionLike>;
  getPlaylist(id: string, maxItems: number): Promise<SpotifyCollectionLike>;
}

export interface ResolveSpotifyCollectionOptions {
  type: 'album' | 'playlist';
  id: string;
  client: SpotifyClientLike;
  maxItems: number;
}

export async function resolveSpotifyCollection({
  type,
  id,
  client,
  maxItems,
}: ResolveSpotifyCollectionOptions): Promise<ResolvedPlaylist> {
  const collection = type === 'album'
    ? await client.getAlbum(id, maxItems)
    : await client.getPlaylist(id, maxItems);

  const items: PlaylistItem[] = collection.tracks.map((track) => ({
    url: buildLazySearchUrl(track),
    title: track.title,
    durationSec: track.durationSec,
    platform: 'youtube',
    author: track.artists[0],
    thumbnail: track.thumbnail,
  }));

  return {
    kind: type === 'album' ? 'spotify-album' : 'spotify-playlist',
    title: collection.name,
    items,
    totalCount: collection.total,
    truncated: items.length < collection.total,
  };
}
