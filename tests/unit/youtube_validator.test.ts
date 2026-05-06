/**
 * YouTube Validator Unit Tests
 * Verifies URL pattern matching and video ID extraction.
 */

import YouTubeValidator = require('../../src/youtube/validator');

jest.mock('../../src/services/logger_service', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

describe('YouTubeValidator', () => {
  describe('isValidYouTubeUrl', () => {
    const validCases: [string, string][] = [
      ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'standard'],
      ['https://youtube.com/watch?v=dQw4w9WgXcQ', 'no www'],
      ['http://www.youtube.com/watch?v=dQw4w9WgXcQ', 'http'],
      ['https://youtu.be/dQw4w9WgXcQ', 'short'],
      ['https://www.youtube.com/embed/dQw4w9WgXcQ', 'embed'],
      ['https://music.youtube.com/watch?v=dQw4w9WgXcQ', 'music'],
      ['https://www.youtube.com/shorts/dQw4w9WgXcQ', 'shorts'],
      ['https://www.youtube.com/live/dQw4w9WgXcQ', 'live'],
      ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=120', 'with timestamp'],
      ['https://www.youtube.com/watch?list=PLxyz&v=dQw4w9WgXcQ', 'v not first param'],
    ];

    test.each(validCases)('%s → true (%s)', (url) => {
      expect(YouTubeValidator.isValidYouTubeUrl(url)).toBe(true);
    });

    const invalidCases: [string, string][] = [
      ['https://www.youtube.com/', 'homepage'],
      ['https://www.youtube.com/results?search_query=test', 'search results'],
      ['https://www.youtube.com/watch?v=short', 'ID too short'],
      ['https://www.bilibili.com/video/BV1xx411c7BF', 'bilibili URL'],
      ['not a url', 'plain text'],
      ['', 'empty string'],
    ];

    test.each(invalidCases)('%s → false (%s)', (url) => {
      expect(YouTubeValidator.isValidYouTubeUrl(url)).toBe(false);
    });
  });

  describe('extractVideoId', () => {
    test('standard URL', () => {
      const result = YouTubeValidator.extractVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      expect(result).toEqual({ type: 'STANDARD', id: 'dQw4w9WgXcQ' });
    });

    test('short URL', () => {
      const result = YouTubeValidator.extractVideoId('https://youtu.be/dQw4w9WgXcQ');
      expect(result).toEqual({ type: 'SHORT', id: 'dQw4w9WgXcQ' });
    });

    test('embed URL', () => {
      const result = YouTubeValidator.extractVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ');
      expect(result).toEqual({ type: 'EMBED', id: 'dQw4w9WgXcQ' });
    });

    test('music URL', () => {
      const result = YouTubeValidator.extractVideoId('https://music.youtube.com/watch?v=dQw4w9WgXcQ');
      expect(result).toEqual({ type: 'MUSIC', id: 'dQw4w9WgXcQ' });
    });

    test('invalid URL returns null', () => {
      expect(YouTubeValidator.extractVideoId('not a url')).toBeNull();
    });

    test('null input returns null', () => {
      expect(YouTubeValidator.extractVideoId(null as unknown as string)).toBeNull();
    });
  });

  describe('normalizeUrl', () => {
    test('normalizes all formats to standard watch URL', () => {
      const urls = [
        'https://youtu.be/dQw4w9WgXcQ',
        'https://www.youtube.com/embed/dQw4w9WgXcQ',
        'https://music.youtube.com/watch?v=dQw4w9WgXcQ',
        'https://www.youtube.com/shorts/dQw4w9WgXcQ',
      ];

      for (const url of urls) {
        expect(YouTubeValidator.normalizeUrl(url)).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      }
    });

    test('invalid URL returns null', () => {
      expect(YouTubeValidator.normalizeUrl('not a url')).toBeNull();
    });
  });
});
