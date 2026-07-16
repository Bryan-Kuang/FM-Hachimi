/**
 * Spotify → YouTube resolution. Spotify never serves audio directly, so a
 * single-track match is done by searching YouTube for the closest video
 * (scored by duration proximity); bulk items (albums/playlists) instead get
 * a lazy `ytsearch1:` pseudo-URL resolved at play time (see
 * playlists/spotify_playlist_resolver.ts, Phase 2).
 */

interface SpotifyTrackMetaLike {
  title: string;
  artists: string[];
  durationSec: number;
}

interface YouTubeSearchResultLike {
  url: string;
  title: string;
  duration: number | string;
}

interface YouTubeSearchResponseLike {
  success: boolean;
  results?: YouTubeSearchResultLike[];
}

interface YouTubeExtractorLike {
  searchVideos(keyword: string, limit: number): Promise<YouTubeSearchResponseLike>;
}

const DURATION_MATCH_THRESHOLD_SEC = 15;

export function buildSearchQuery(t: SpotifyTrackMetaLike): string {
  return `${t.artists[0] ?? ''} ${t.title}`.trim();
}

export function buildLazySearchUrl(t: SpotifyTrackMetaLike): string {
  return `ytsearch1:${buildSearchQuery(t)}`;
}

export async function findYouTubeMatch(
  t: SpotifyTrackMetaLike,
  youtubeExtractor: YouTubeExtractorLike,
): Promise<{ url: string; title: string } | null> {
  let response: YouTubeSearchResponseLike;
  try {
    response = await youtubeExtractor.searchVideos(buildSearchQuery(t), 5);
  } catch {
    return null;
  }

  if (!response.success || !response.results || response.results.length === 0) {
    return null;
  }

  const results = response.results;
  let best: YouTubeSearchResultLike | null = null;
  let bestDiff = Infinity;
  for (const result of results) {
    const diff = Math.abs(Number(result.duration) - t.durationSec);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = result;
    }
  }

  const chosen = best && bestDiff <= DURATION_MATCH_THRESHOLD_SEC ? best : results[0];
  return { url: chosen.url, title: chosen.title };
}
