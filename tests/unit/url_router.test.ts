/**
 * URL Router Unit Tests
 * Verifies platform routing for Bilibili, YouTube, and keyword inputs.
 */

import { routeQuery, Platform } from '../../src/utils/url_router';

describe('routeQuery', () => {
  // ─── Bilibili URLs ──────────────────────────────────────────────────────────
  describe('Bilibili URLs', () => {
    const bilibiliCases: [string, string][] = [
      ['https://www.bilibili.com/video/BV1xx411c7BF', 'standard BV URL'],
      ['https://bilibili.com/video/BV1xx411c7BF', 'no www'],
      ['https://b23.tv/BV1xx411c7BF', 'short URL'],
      ['https://www.bilibili.com/video/av170001', 'av URL'],
    ];

    test.each(bilibiliCases)('%s → bilibili', (url, _desc) => {
      const result = routeQuery(url);
      expect(result.platform).toBe('bilibili' as Platform);
      expect(result.isUrl).toBe(true);
      expect(result.raw).toBe(url);
      expect(result.kind).toBe('bilibili-video');
    });
  });

  // ─── YouTube URLs ───────────────────────────────────────────────────────────
  describe('YouTube URLs', () => {
    const youtubeCases: [string, string][] = [
      ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'standard'],
      ['https://youtu.be/dQw4w9WgXcQ', 'short'],
      ['https://www.youtube.com/embed/dQw4w9WgXcQ', 'embed'],
      ['https://music.youtube.com/watch?v=dQw4w9WgXcQ', 'music'],
      ['https://www.youtube.com/shorts/dQw4w9WgXcQ', 'shorts'],
      ['https://www.youtube.com/live/dQw4w9WgXcQ', 'live'],
      ['https://youtube.com/watch?v=dQw4w9WgXcQ&list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf', 'with params'],
    ];

    test.each(youtubeCases)('%s → youtube', (url, _desc) => {
      const result = routeQuery(url);
      expect(result.platform).toBe('youtube' as Platform);
      expect(result.isUrl).toBe(true);
      expect(result.normalizedUrl).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      expect(result.raw).toBe(url);
      expect(result.kind).toBe('youtube-video');
    });

    test('watch?v=X&list=Y → youtube-video (v= wins)', () => {
      const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf';
      const result = routeQuery(url);
      expect(result.kind).toBe('youtube-video');
      expect(result.platform).toBe('youtube');
      expect(result.normalizedUrl).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    });
  });

  // ─── YouTube playlists ──────────────────────────────────────────────────────
  describe('YouTube playlists', () => {
    test('youtube.com/playlist?list= → youtube-playlist', () => {
      const url = 'https://www.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf';
      const result = routeQuery(url);
      expect(result.kind).toBe('youtube-playlist');
      expect(result.platform).toBe('youtube');
      expect(result.isUrl).toBe(true);
      expect(result.youtubePlaylist).toEqual({ listId: 'PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf' });
    });

    test('music.youtube.com/playlist?list= → youtube-playlist', () => {
      const url = 'https://music.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf';
      const result = routeQuery(url);
      expect(result.kind).toBe('youtube-playlist');
      expect(result.youtubePlaylist).toEqual({ listId: 'PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf' });
    });
  });

  // ─── Bilibili favorites/collections ─────────────────────────────────────────
  describe('Bilibili favorites', () => {
    test('space.bilibili.com favlist → bilibili-fav', () => {
      const url = 'https://space.bilibili.com/123456/favlist?fid=789';
      const result = routeQuery(url);
      expect(result.kind).toBe('bilibili-fav');
      expect(result.platform).toBe('bilibili');
      expect(result.bilibiliFav).toEqual({ mediaId: '789' });
    });

    test('favlist with params before fid → bilibili-fav', () => {
      const url = 'https://space.bilibili.com/123456/favlist?ftype=create&fid=789';
      const result = routeQuery(url);
      expect(result.kind).toBe('bilibili-fav');
      expect(result.bilibiliFav).toEqual({ mediaId: '789' });
    });

    test('bilibili.com/medialist/detail/mlXXXX → bilibili-fav', () => {
      const url = 'https://www.bilibili.com/medialist/detail/ml789';
      const result = routeQuery(url);
      expect(result.kind).toBe('bilibili-fav');
      expect(result.bilibiliFav).toEqual({ mediaId: '789' });
    });

    test('bilibili.com/medialist/play/mlXXXX → bilibili-fav', () => {
      const url = 'https://www.bilibili.com/medialist/play/ml789';
      const result = routeQuery(url);
      expect(result.kind).toBe('bilibili-fav');
      expect(result.bilibiliFav).toEqual({ mediaId: '789' });
    });
  });

  describe('Bilibili collections', () => {
    test('old collectiondetail form → season', () => {
      const url = 'https://space.bilibili.com/123456/channel/collectiondetail?sid=999';
      const result = routeQuery(url);
      expect(result.kind).toBe('bilibili-collection');
      expect(result.bilibiliCollection).toEqual({ mid: '123456', seasonId: '999', listType: 'season' });
    });

    test('new /lists/ form defaults to season', () => {
      const url = 'https://space.bilibili.com/123456/lists/999';
      const result = routeQuery(url);
      expect(result.kind).toBe('bilibili-collection');
      expect(result.bilibiliCollection).toEqual({ mid: '123456', seasonId: '999', listType: 'season' });
    });

    test('new /lists/ form with type=series', () => {
      const url = 'https://space.bilibili.com/123456/lists/999?type=series';
      const result = routeQuery(url);
      expect(result.kind).toBe('bilibili-collection');
      expect(result.bilibiliCollection).toEqual({ mid: '123456', seasonId: '999', listType: 'series' });
    });
  });

  // ─── Spotify ────────────────────────────────────────────────────────────────
  describe('Spotify', () => {
    test('open.spotify.com track URL → spotify', () => {
      const url = 'https://open.spotify.com/track/6rqhFgbbKwnb9MLmUQDhG6';
      const result = routeQuery(url);
      expect(result.kind).toBe('spotify');
      expect(result.isUrl).toBe(true);
      expect(result.spotify).toEqual({ type: 'track', id: '6rqhFgbbKwnb9MLmUQDhG6' });
      expect(result.normalizedUrl).toBe('https://open.spotify.com/track/6rqhFgbbKwnb9MLmUQDhG6');
    });

    test('intl-prefixed Spotify URL → spotify', () => {
      const url = 'https://open.spotify.com/intl-de/track/6rqhFgbbKwnb9MLmUQDhG6';
      const result = routeQuery(url);
      expect(result.kind).toBe('spotify');
      expect(result.spotify).toEqual({ type: 'track', id: '6rqhFgbbKwnb9MLmUQDhG6' });
    });

    test('spotify: URI → spotify (isUrl true)', () => {
      const uri = 'spotify:track:6rqhFgbbKwnb9MLmUQDhG6';
      const result = routeQuery(uri);
      expect(result.kind).toBe('spotify');
      expect(result.isUrl).toBe(true);
      expect(result.spotify).toEqual({ type: 'track', id: '6rqhFgbbKwnb9MLmUQDhG6' });
    });

    test('album and playlist kinds parsed', () => {
      const album = routeQuery('https://open.spotify.com/album/6rqhFgbbKwnb9MLmUQDhG6');
      expect(album.spotify?.type).toBe('album');
      const playlist = routeQuery('https://open.spotify.com/playlist/6rqhFgbbKwnb9MLmUQDhG6');
      expect(playlist.spotify?.type).toBe('playlist');
    });
  });

  // ─── Discord attachments ────────────────────────────────────────────────────
  describe('Discord CDN attachment links', () => {
    test('cdn.discordapp.com → attachment', () => {
      const url = 'https://cdn.discordapp.com/attachments/1/2/song.mp3';
      const result = routeQuery(url);
      expect(result.kind).toBe('attachment');
      expect(result.isUrl).toBe(true);
      expect(result.normalizedUrl).toBe(url);
    });

    test('media.discordapp.net → attachment', () => {
      const url = 'https://media.discordapp.net/attachments/1/2/song.mp3';
      const result = routeQuery(url);
      expect(result.kind).toBe('attachment');
    });
  });

  // ─── Unknown URLs ───────────────────────────────────────────────────────────
  describe('Unknown URLs', () => {
    test('unsupported platform URL', () => {
      const result = routeQuery('https://soundcloud.com/artist/track');
      expect(result.platform).toBe('unknown');
      expect(result.isUrl).toBe(true);
      expect(result.normalizedUrl).toBeNull();
      expect(result.kind).toBe('unknown-url');
    });
  });

  // ─── Keyword search ─────────────────────────────────────────────────────────
  describe('Keyword search', () => {
    test('plain keyword', () => {
      const result = routeQuery('never gonna give you up');
      expect(result.platform).toBe('unknown');
      expect(result.isUrl).toBe(false);
      expect(result.normalizedUrl).toBeNull();
      expect(result.raw).toBe('never gonna give you up');
      expect(result.kind).toBe('keyword');
    });

    test('trims whitespace', () => {
      const result = routeQuery('  hello world  ');
      expect(result.raw).toBe('hello world');
    });
  });

  // ─── Edge cases ─────────────────────────────────────────────────────────────
  describe('Edge cases', () => {
    test('empty string', () => {
      const result = routeQuery('');
      expect(result.platform).toBe('unknown');
      expect(result.isUrl).toBe(false);
      expect(result.kind).toBe('keyword');
    });

    test('null-ish input', () => {
      const result = routeQuery(null as unknown as string);
      expect(result.platform).toBe('unknown');
      expect(result.isUrl).toBe(false);
    });
  });
});
