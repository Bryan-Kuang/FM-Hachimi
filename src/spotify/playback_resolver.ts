/**
 * Spotify playback resolution seam.
 *
 * Spotify search results/selections don't carry a directly playable URL, so
 * every consumer (the tri-platform search select handler today; Project B's
 * direct-extraction path later) goes through this single function to turn a
 * chosen track into something the playback pipeline can use.
 *
 * Project A implementation: always resolves via a YouTube search match
 * (`findYouTubeMatch`) — the same fallback PR #142 already uses for pasted
 * Spotify track links. Project B swaps this file's internals to try direct
 * audio extraction (librespot sidecar) first, falling back to this same
 * YouTube-match behavior on any failure — the public signature and the
 * `kind: 'youtube-url'` variant are deliberately kept stable so that swap
 * doesn't ripple into callers.
 */

import { findYouTubeMatch } from './resolver';

export interface SpotifyPlaybackTarget {
  kind: 'youtube-url';
  url: string;
  title: string;
}

interface SpotifyTrackMetaLike {
  id: string;
  title: string;
  artists: string[];
  durationSec: number;
}

interface YouTubeSearchResponseLike {
  success: boolean;
  results?: { url: string; title: string; duration: number | string }[];
}

interface YouTubeExtractorLike {
  searchVideos(keyword: string, limit: number): Promise<YouTubeSearchResponseLike>;
}

interface ResolveSpotifyPlaybackDeps {
  youtubeExtractor: unknown;
}

export async function resolveSpotifyPlayback(
  meta: SpotifyTrackMetaLike,
  deps: ResolveSpotifyPlaybackDeps,
): Promise<SpotifyPlaybackTarget | null> {
  const extractor = deps.youtubeExtractor as YouTubeExtractorLike | null | undefined;
  if (!extractor || typeof extractor.searchVideos !== 'function') return null;

  try {
    const match = await findYouTubeMatch(meta, extractor);
    if (!match) return null;
    return { kind: 'youtube-url', url: match.url, title: match.title };
  } catch {
    return null;
  }
}
