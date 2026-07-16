/**
 * Spotify Web API client (client-credentials flow — metadata only, no user
 * auth, no audio). Used to resolve open.spotify.com links to track/album/
 * playlist metadata, which is then matched against YouTube search results
 * (see spotify/resolver.ts) since Spotify does not serve audio streams.
 */

import * as logger from '../services/logger_service';
import type { SpotifySearchResult } from './types';

interface SpotifyTrackMeta {
  title: string;
  artists: string[];
  durationSec: number;
  albumName?: string;
  thumbnail?: string;
}

interface SpotifyCollection {
  kind: 'album' | 'playlist';
  name: string;
  /** API-reported total item count, pre-cap. */
  total: number;
  /** Capped at the caller's maxItems. */
  tracks: SpotifyTrackMeta[];
  /** null-track / is_local / episode entries skipped during pagination. */
  skipped: number;
}


interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

interface SpotifyClientOptions {
  clientId: string;
  clientSecret: string;
  market?: string;
}

interface RawSpotifyArtist {
  name: string;
}

interface RawSpotifyImage {
  url: string;
}

interface RawSpotifyTrack {
  name: string;
  duration_ms: number;
  artists: RawSpotifyArtist[];
  album?: { name: string; images?: RawSpotifyImage[] };
  type?: string;
}

interface RawPlaylistTrackItem {
  is_local?: boolean;
  track: RawSpotifyTrack | null;
}

interface RawSpotifySearchTrack {
  id: string;
  name: string;
  duration_ms: number;
  artists: RawSpotifyArtist[];
  album?: { images?: RawSpotifyImage[] };
}

interface RawSpotifySearchResponse {
  tracks?: { items?: RawSpotifySearchTrack[] };
}

const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const API_BASE = 'https://api.spotify.com/v1';

function toTrackMeta(track: RawSpotifyTrack): SpotifyTrackMeta {
  return {
    title: track.name,
    artists: (track.artists || []).map((a) => a.name),
    durationSec: Math.round((track.duration_ms || 0) / 1000),
    albumName: track.album?.name,
    thumbnail: track.album?.images?.[0]?.url,
  };
}

class SpotifyClient {
  private clientId: string;
  private clientSecret: string;
  private market: string;
  private token: CachedToken | null;

  constructor(opts: SpotifyClientOptions) {
    this.clientId = opts.clientId;
    this.clientSecret = opts.clientSecret;
    this.market = opts.market || 'US';
    this.token = null;
  }

  /**
   * Configured market (ISO 3166-1 alpha-2). Not currently sent to Spotify —
   * every endpoint we call deliberately omits `market` (see getTrack) so a
   * region-restricted item still returns metadata instead of a null track.
   * Exposed for callers/tests that want to confirm what market was configured.
   */
  getMarket(): string {
    return this.market;
  }

  async getTrack(id: string): Promise<SpotifyTrackMeta> {
    // No `market` param — passing one can null out region-restricted tracks
    // in the response, and we only need metadata (title/artist/duration) for
    // the downstream YouTube search match, not playback eligibility.
    const data = await this.apiGet(`/tracks/${id}`) as RawSpotifyTrack;
    return toTrackMeta(data);
  }

  async getAlbum(id: string, maxItems: number): Promise<SpotifyCollection> {
    const album = await this.apiGet(`/albums/${id}`) as {
      name: string;
      tracks: { items: RawSpotifyTrack[]; total: number; next: string | null };
    };

    const tracks: SpotifyTrackMeta[] = [];
    let skipped = 0;
    const total = album.tracks?.total ?? 0;

    let items = album.tracks?.items ?? [];
    let next = album.tracks?.next ?? null;
    let offset = items.length;

    for (;;) {
      for (const track of items) {
        if (tracks.length >= maxItems) break;
        if (!track || track.type === 'episode') {
          skipped++;
          continue;
        }
        tracks.push(toTrackMeta(track));
      }
      if (tracks.length >= maxItems || !next) break;

      const page = await this.apiGet(`/albums/${id}/tracks?limit=50&offset=${offset}`) as {
        items: RawSpotifyTrack[];
        next: string | null;
      };
      items = page.items ?? [];
      next = page.next ?? null;
      offset += items.length;
    }

    return { kind: 'album', name: album.name, total, tracks, skipped };
  }

  async getPlaylist(id: string, maxItems: number): Promise<SpotifyCollection> {
    const meta = await this.apiGet(`/playlists/${id}?fields=name,tracks.total`) as {
      name: string;
      tracks: { total: number };
    };

    const tracks: SpotifyTrackMeta[] = [];
    let skipped = 0;
    let offset = 0;
    let next: string | null = 'first-page';

    while (next && tracks.length < maxItems) {
      const path = `/playlists/${id}/tracks?limit=100&offset=${offset}&fields=items(is_local,track(name,duration_ms,type,artists(name))),next`;
      const page = await this.apiGet(path) as { items: RawPlaylistTrackItem[]; next: string | null };
      const items = page.items ?? [];

      for (const item of items) {
        if (tracks.length >= maxItems) break;
        if (!item.track || item.is_local === true || item.track.type !== 'track') {
          skipped++;
          continue;
        }
        tracks.push(toTrackMeta(item.track));
      }

      offset += items.length;
      next = page.next ?? null;
    }

    return { kind: 'playlist', name: meta.name, total: meta.tracks?.total ?? 0, tracks, skipped };
  }

  /**
   * Catalog search — used by the tri-platform keyword search (Project A).
   * Keeps Spotify's own relevance ordering; the caller ranks/interleaves it
   * against the other platforms. Empty/missing items resolve to `[]` rather
   * than throwing so the caller's Promise.allSettled fallback stays simple.
   */
  async searchTracks(keyword: string, limit: number): Promise<SpotifySearchResult[]> {
    const query = encodeURIComponent(keyword);
    const path = `/search?q=${query}&type=track&limit=${limit}&market=${this.market}`;
    const data = await this.apiGet(path) as RawSpotifySearchResponse;
    const items = data.tracks?.items ?? [];
    return items.map((track) => ({
      id: track.id,
      title: track.name,
      artists: (track.artists || []).map((a) => a.name),
      durationSec: Math.round((track.duration_ms || 0) / 1000),
      thumbnail: track.album?.images?.[0]?.url,
    }));
  }

  private async getAccessToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt - 60_000) {
      return this.token.accessToken;
    }

    const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    let response: Response;
    try {
      response = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basic}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
      });
    } catch (error) {
      logger.error('Spotify token request failed', { error: (error as Error).message });
      throw new Error('SPOTIFY_AUTH_FAILED');
    }

    if (response.status === 400 || response.status === 401) {
      throw new Error('SPOTIFY_AUTH_FAILED');
    }
    if (!response.ok) {
      throw new Error('SPOTIFY_AUTH_FAILED');
    }

    const body = await response.json() as { access_token: string; expires_in: number };
    this.token = {
      accessToken: body.access_token,
      expiresAt: Date.now() + body.expires_in * 1000,
    };
    return this.token.accessToken;
  }

  private async apiGet(path: string, isRetry = false): Promise<unknown> {
    const token = await this.getAccessToken();
    let response: Response;
    try {
      response = await fetch(`${API_BASE}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (error) {
      logger.error('Spotify API request failed', { path, error: (error as Error).message });
      throw error;
    }

    if (response.status === 401) {
      if (isRetry) throw new Error('SPOTIFY_AUTH_FAILED');
      this.token = null;
      return this.apiGet(path, true);
    }

    if (response.status === 429 && !isRetry) {
      const retryAfterHeader = Number(response.headers.get('Retry-After'));
      const waitSec = Math.min(Number.isFinite(retryAfterHeader) ? retryAfterHeader : 5, 5);
      await new Promise((resolve) => setTimeout(resolve, waitSec * 1000));
      return this.apiGet(path, true);
    }

    if (response.status === 404) {
      throw new Error('SPOTIFY_NOT_FOUND');
    }

    if (!response.ok) {
      const bodySnippet = await response.text().then((t) => t.slice(0, 200)).catch(() => '');
      throw new Error(`Spotify API error ${response.status}: ${bodySnippet}`);
    }

    return response.json();
  }
}

export = SpotifyClient;
