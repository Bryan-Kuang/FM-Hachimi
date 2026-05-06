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
    });
  });

  // ─── Unknown URLs ───────────────────────────────────────────────────────────
  describe('Unknown URLs', () => {
    test('unsupported platform URL', () => {
      const result = routeQuery('https://soundcloud.com/artist/track');
      expect(result.platform).toBe('unknown');
      expect(result.isUrl).toBe(true);
      expect(result.normalizedUrl).toBeNull();
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
    });

    test('null-ish input', () => {
      const result = routeQuery(null as unknown as string);
      expect(result.platform).toBe('unknown');
      expect(result.isUrl).toBe(false);
    });
  });
});
