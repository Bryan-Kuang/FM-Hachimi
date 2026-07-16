/**
 * Shared Spotify types used across module boundaries. Kept in their own file
 * because `SpotifyClient` (client.ts) uses `export =` (CommonJS default
 * export), which cannot be combined with other named exports in the same
 * module — TS2309.
 */

/** One catalog search hit from `SpotifyClient.searchTracks`. */
export interface SpotifySearchResult {
  id: string;
  title: string;
  artists: string[];
  durationSec: number;
  thumbnail?: string;
}
