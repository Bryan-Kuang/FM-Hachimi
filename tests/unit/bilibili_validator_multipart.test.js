/**
 * BilibiliValidator multipart (分P) URL Unit Tests
 * Verifies normalizeUrl preserves ?p=N (N>1) while p=1/absent stay bare, and
 * that every pre-existing normalize case remains unchanged (Task 2.3).
 */

jest.mock('../../src/services/logger_service', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const UrlValidator = require('../../src/bilibili/validator');

describe('BilibiliValidator.normalizeUrl — multipart (分P)', () => {
  test('BV URL with p=2 preserves the page suffix', () => {
    expect(UrlValidator.normalizeUrl('https://www.bilibili.com/video/BV1xx411c7BF?p=2'))
      .toBe('https://www.bilibili.com/video/BV1xx411c7BF?p=2');
  });

  test('BV URL with p=1 strips the suffix (stable cache key with bare URL)', () => {
    expect(UrlValidator.normalizeUrl('https://www.bilibili.com/video/BV1xx411c7BF?p=1'))
      .toBe('https://www.bilibili.com/video/BV1xx411c7BF');
  });

  test('BV URL with no p= param stays bare', () => {
    expect(UrlValidator.normalizeUrl('https://www.bilibili.com/video/BV1xx411c7BF'))
      .toBe('https://www.bilibili.com/video/BV1xx411c7BF');
  });

  test('AV URL with p=3 preserves the page suffix', () => {
    expect(UrlValidator.normalizeUrl('https://www.bilibili.com/video/av12345?p=3'))
      .toBe('https://www.bilibili.com/video/av12345?p=3');
  });

  test('p= combined with other query params still extracts correctly', () => {
    expect(UrlValidator.normalizeUrl('https://www.bilibili.com/video/BV1xx411c7BF?p=5&spm_id_from=1'))
      .toBe('https://www.bilibili.com/video/BV1xx411c7BF?p=5');
  });

  test('non-numeric-looking large p value still preserved verbatim', () => {
    expect(UrlValidator.normalizeUrl('https://www.bilibili.com/video/BV1xx411c7BF?p=10'))
      .toBe('https://www.bilibili.com/video/BV1xx411c7BF?p=10');
  });

  // ─── Regression: pre-existing normalize behavior stays unchanged ───────

  test('short link (b23.tv) returned unchanged', () => {
    expect(UrlValidator.normalizeUrl('https://b23.tv/abcdefg')).toBe('https://b23.tv/abcdefg');
  });

  test('mobile URL normalizes to the standard BV form', () => {
    expect(UrlValidator.normalizeUrl('https://m.bilibili.com/video/BV1xx411c7BF'))
      .toBe('https://www.bilibili.com/video/BV1xx411c7BF');
  });

  test('invalid URL returns null', () => {
    expect(UrlValidator.normalizeUrl('https://example.com/not-bilibili')).toBeNull();
  });

  test('AV URL without p= stays bare', () => {
    expect(UrlValidator.normalizeUrl('https://www.bilibili.com/video/av12345'))
      .toBe('https://www.bilibili.com/video/av12345');
  });
});
