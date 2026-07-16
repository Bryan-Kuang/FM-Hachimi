/**
 * Playlist resolution entry point — dispatches a routed URL (see
 * src/utils/url_router.ts RouteResult) to the matching per-source resolver.
 *
 * Multipart Bilibili (分P) is intentionally NOT dispatched here — it's
 * detected separately in the /play command (Task 2.9) since it hangs off the
 * plain 'bilibili-video' route kind, not a dedicated one.
 */

import type { RouteResult } from '../utils/url_router';
import type { ResolvedPlaylist, PlaylistProgress } from './types';
import { resolveYouTubePlaylist } from './youtube_playlist_resolver';
import { resolveBilibiliFav, resolveBilibiliCollection } from './bilibili_playlist_resolver';
import { resolveSpotifyCollection } from './spotify_playlist_resolver';

interface YouTubeExtractorLike {
  listPlaylistItems(playlistUrl: string, limit: number): Promise<{
    success: boolean;
    playlistTitle?: string;
    entries?: Array<{ id: string; title: string; duration: number; uploader: string; url: string }>;
    error?: string;
  }>;
}

interface BilibiliApiLike {
  getFavFolderPage(mediaId: string, pn: number, ps?: number): Promise<{
    title: string;
    mediaCount: number;
    hasMore: boolean;
    items: Array<{ bvid: string; title: string; durationSec: number; author: string; cover: string }>;
  }>;
  getCollectionPage(
    mid: string,
    seasonId: string,
    pageNum: number,
    listType: 'season' | 'series',
    ps?: number,
  ): Promise<{
    title: string;
    total: number;
    items: Array<{ bvid: string; title: string; durationSec: number; cover: string }>;
  }>;
  getVideoPages(bvid: string): Promise<{
    title: string;
    pages: Array<{ page: number; part: string; durationSec: number; cid: number }>;
  }>;
}

interface SpotifyClientLike {
  getAlbum(id: string, maxItems: number): Promise<{ name: string; total: number; tracks: Array<{ title: string; artists: string[]; durationSec: number; thumbnail?: string }> }>;
  getPlaylist(id: string, maxItems: number): Promise<{ name: string; total: number; tracks: Array<{ title: string; artists: string[]; durationSec: number; thumbnail?: string }> }>;
}

export interface ResolvePlaylistDeps {
  youtubeExtractor?: YouTubeExtractorLike | null;
  bilibiliApi?: BilibiliApiLike | null;
  spotifyClient?: SpotifyClientLike | null;
  maxItems: number;
  onProgress?: PlaylistProgress;
}

export async function resolvePlaylist(route: RouteResult, deps: ResolvePlaylistDeps): Promise<ResolvedPlaylist> {
  switch (route.kind) {
    case 'youtube-playlist': {
      if (!route.youtubePlaylist) throw new Error('Missing YouTube playlist id');
      if (!deps.youtubeExtractor) throw new Error('YouTube support is not available');
      return resolveYouTubePlaylist({
        listId: route.youtubePlaylist.listId,
        youtubeExtractor: deps.youtubeExtractor,
        maxItems: deps.maxItems,
      });
    }

    case 'bilibili-fav': {
      if (!route.bilibiliFav) throw new Error('Missing Bilibili favorites id');
      if (!deps.bilibiliApi) throw new Error('Bilibili API is not available');
      return resolveBilibiliFav({
        mediaId: route.bilibiliFav.mediaId,
        api: deps.bilibiliApi,
        maxItems: deps.maxItems,
        onProgress: deps.onProgress,
      });
    }

    case 'bilibili-collection': {
      if (!route.bilibiliCollection) throw new Error('Missing Bilibili collection id');
      if (!deps.bilibiliApi) throw new Error('Bilibili API is not available');
      const { mid, seasonId, listType } = route.bilibiliCollection;
      return resolveBilibiliCollection({
        mid,
        seasonId,
        listType,
        api: deps.bilibiliApi,
        maxItems: deps.maxItems,
        onProgress: deps.onProgress,
      });
    }

    case 'spotify': {
      if (!route.spotify || route.spotify.type === 'track') {
        throw new Error('Not a bulk Spotify album/playlist route');
      }
      if (!deps.spotifyClient) throw new Error('Spotify support is not available');
      return resolveSpotifyCollection({
        type: route.spotify.type,
        id: route.spotify.id,
        client: deps.spotifyClient,
        maxItems: deps.maxItems,
      });
    }

    default:
      throw new Error(`Unsupported playlist route kind: ${route.kind}`);
  }
}

export type { PlaylistItem, ResolvedPlaylist, PlaylistProgress } from './types';
