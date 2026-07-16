/**
 * Spotify playback resolution seam.
 *
 * Spotify search results/selections don't carry a directly playable URL, so
 * every consumer (the tri-platform search select handler, the pasted-link
 * branch in play.ts) goes through this single function to turn a chosen
 * track into something the playback pipeline can use.
 *
 * Project B implementation: direct audio extraction (a librespot-family
 * sidecar — see spotify/direct_extractor.ts) is tried first when configured;
 * on ANY failure (not logged in, sidecar crash, timeout, no output file) it
 * falls back to the Project A behavior — a YouTube search match
 * (`findYouTubeMatch`), same as PR #142 always did. `null` only when *both*
 * paths fail (or produce no result).
 *
 * Radio rule: while radio is enabled for the guild, direct extraction is
 * skipped entirely and resolution goes straight to the YouTube-match path.
 * Radio's `playNow()` only knows how to (re-)extract from a URL — it can't
 * accept an already-built local-file track (`playAttachment`, which a
 * `kind: 'direct'` target would otherwise go through, itself refuses outright
 * while radio is enabled — see playlist_coordinator.ts). The resolver takes
 * the `radioActive` flag rather than leaving this to callers so a radio
 * guild never pays for a direct-extraction fetch it can't use.
 */

import { findYouTubeMatch } from './resolver';
import * as logger from '../services/logger_service';

export type SpotifyPlaybackTarget =
  | { kind: 'youtube-url'; url: string; title: string }
  | { kind: 'direct'; data: SpotifyDirectExtractedTrackLike };

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

/** Shape of SpotifyDirectExtractor.extractAudio's resolved value — kept structural to avoid an import cycle. */
interface SpotifyDirectExtractedTrackLike {
  title: string;
  audioUrl: string;
  duration: number;
  cached: true;
  extractedAt: string;
}

interface SpotifyDirectExtractorLike {
  isConfigured(): boolean;
  extractAudio(trackId: string, meta: { title: string; durationSec?: number }): Promise<SpotifyDirectExtractedTrackLike>;
}

interface ResolveSpotifyPlaybackDeps {
  youtubeExtractor: unknown;
  /** Project B's sidecar-backed extractor. Absent/unconfigured → straight to YouTube match. */
  directExtractor?: SpotifyDirectExtractorLike | null;
  /** True when radio owns the guild's queue — see "Radio rule" above. */
  radioActive?: boolean;
}

async function resolveViaYouTubeMatch(
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

export async function resolveSpotifyPlayback(
  meta: SpotifyTrackMetaLike,
  deps: ResolveSpotifyPlaybackDeps,
): Promise<SpotifyPlaybackTarget | null> {
  if (!deps.radioActive && deps.directExtractor?.isConfigured()) {
    try {
      const data = await deps.directExtractor.extractAudio(meta.id, {
        title: meta.title,
        durationSec: meta.durationSec,
      });
      return { kind: 'direct', data };
    } catch (error: unknown) {
      logger.warn('Spotify direct extraction failed — falling back to YouTube match', {
        trackId: meta.id,
        error: (error as Error).message,
      });
    }
  }

  return resolveViaYouTubeMatch(meta, deps);
}
