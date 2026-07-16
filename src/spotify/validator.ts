/**
 * Spotify Link Validator
 * Parses open.spotify.com URLs and spotify:<kind>:<id> URIs for tracks,
 * albums, and playlists.
 */

// Not exported: `export =` below is the module's only export (CommonJS
// convention). Consumers get these shapes via `ReturnType<typeof
// SpotifyValidator.parse>` if ever needed; none currently import them by name.
type SpotifyKind = 'track' | 'album' | 'playlist';

interface ParsedSpotifyUrl {
  kind: SpotifyKind;
  id: string;
}

class SpotifyValidator {
  // Matches open.spotify.com/{track|album|playlist}/{id}, tolerating the
  // optional locale prefix Spotify sometimes inserts (intl-de, intl-pt-BR, …).
  static URL_PATTERN =
    /^(?:https?:\/\/)?open\.spotify\.com\/(?:intl-[a-z]{2}(?:-[A-Za-z]{2})?\/)?(track|album|playlist)\/([A-Za-z0-9]{22})/;

  static URI_PATTERN = /^spotify:(track|album|playlist):([A-Za-z0-9]{22})$/;

  static isSpotifyUrl(input: string): boolean {
    if (!input || typeof input !== 'string') return false;
    const trimmed = input.trim();
    return this.URL_PATTERN.test(trimmed) || this.URI_PATTERN.test(trimmed);
  }

  static parse(input: string): ParsedSpotifyUrl | null {
    if (!input || typeof input !== 'string') return null;
    const trimmed = input.trim();

    const urlMatch = trimmed.match(this.URL_PATTERN);
    if (urlMatch) {
      return { kind: urlMatch[1] as SpotifyKind, id: urlMatch[2] };
    }

    const uriMatch = trimmed.match(this.URI_PATTERN);
    if (uriMatch) {
      return { kind: uriMatch[1] as SpotifyKind, id: uriMatch[2] };
    }

    return null;
  }
}

export = SpotifyValidator;
