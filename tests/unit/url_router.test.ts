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

  test.each([
    'https://www.youtube.com/playlist?list=PL123',
    'youtube.com/playlist?list=PL123',
    'https://space.bilibili.com/123/favlist?fid=456',
    'https://www.bilibili.com/medialist/play/ml123',
    'space.bilibili.com/123/lists/456',
    'https://space.bilibili.com/123/channel/collectiondetail?sid=456',
    'https://cdn.discordapp.com/attachments/1/2/song.mp3',
    'https://media.discordapp.net/attachments/1/2/song.mp3',
  ])('rejects unsupported collection or attachment: %s', url => {
    expect(routeQuery(url)).toMatchObject({ kind: 'unknown-url', platform: 'unknown', isUrl: true, normalizedUrl: null });
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
