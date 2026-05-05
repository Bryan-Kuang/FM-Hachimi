/**
 * Unit tests for Queue — pure data structure, no mocking needed
 * except for the logger (which Queue imports for info/warn logging).
 */

import Queue from '../queue';
import type { TrackData } from '../../types';

// Suppress logger output during tests
jest.mock('../../services/logger_service', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

function makeTrack(title: string, duration = 180): TrackData {
  return {
    bvid: `BV${title}`,
    title,
    audioUrl: `https://cdn.bilibili.com/${title}.m4a`,
    duration,
  };
}

describe('Queue', () => {
  let q: InstanceType<typeof Queue>;

  beforeEach(() => {
    q = new Queue();
  });

  // ── Construction ──────────────────────────────────────────────────────

  it('starts empty with default queue loop', () => {
    expect(q.length).toBe(0);
    expect(q.isEmpty).toBe(true);
    expect(q.currentIndex).toBe(-1);
    expect(q.currentTrack).toBeNull();
    expect(q.loopMode).toBe('queue');
  });

  // ── add / remove ──────────────────────────────────────────────────────

  it('adds tracks and returns Track instances', () => {
    const t = q.add(makeTrack('Song A'), '<@1>');
    expect(t.title).toBe('Song A');
    expect(q.length).toBe(1);
  });

  it('removes a track by index and adjusts currentIndex', () => {
    q.add(makeTrack('A'), '<@1>');
    q.add(makeTrack('B'), '<@1>');
    q.add(makeTrack('C'), '<@1>');
    q.currentIndex = 2;
    q.currentTrack = q.items[2];

    // Remove before current → currentIndex decrements
    expect(q.remove(0)).toBe(true);
    expect(q.currentIndex).toBe(1);
    expect(q.length).toBe(2);
  });

  it('refuses to remove the currently-playing track', () => {
    q.add(makeTrack('A'), '<@1>');
    q.currentIndex = 0;
    q.currentTrack = q.items[0];
    expect(q.remove(0)).toBe(false);
  });

  it('refuses invalid indices', () => {
    expect(q.remove(-1)).toBe(false);
    expect(q.remove(99)).toBe(false);
  });

  // ── clear / reset ─────────────────────────────────────────────────────

  it('clear keeps the current track', () => {
    q.add(makeTrack('A'), '<@1>');
    q.add(makeTrack('B'), '<@1>');
    q.currentIndex = 1;
    q.currentTrack = q.items[1];
    q.clear();
    expect(q.length).toBe(1);
    expect(q.items[0].title).toBe('B');
    expect(q.currentIndex).toBe(0);
  });

  it('reset empties everything', () => {
    q.add(makeTrack('A'), '<@1>');
    q.currentTrack = q.items[0];
    q.reset();
    expect(q.length).toBe(0);
    expect(q.currentTrack).toBeNull();
    expect(q.currentIndex).toBe(-1);
  });

  // ── shuffle ───────────────────────────────────────────────────────────

  it('shuffle keeps current track at index 0', () => {
    q.add(makeTrack('A'), '<@1>');
    q.add(makeTrack('B'), '<@1>');
    q.add(makeTrack('C'), '<@1>');
    q.currentIndex = 1;
    q.currentTrack = q.items[1];

    q.shuffle();
    expect(q.items[0].title).toBe('B');
    expect(q.currentIndex).toBe(0);
    expect(q.length).toBe(3);
  });

  // ── navigation: peekNext ──────────────────────────────────────────────

  it('peekNext returns null on empty queue', () => {
    expect(q.peekNext()).toBeNull();
  });

  it('peekNext starts at index 0 when no current track', () => {
    q.add(makeTrack('A'), '<@1>');
    q.add(makeTrack('B'), '<@1>');
    const t = q.peekNext();
    expect(t?.title).toBe('A');
    expect(q.currentIndex).toBe(0);
  });

  // ── navigation: advance ───────────────────────────────────────────────

  it('advance moves to next track', () => {
    q.add(makeTrack('A'), '<@1>');
    q.add(makeTrack('B'), '<@1>');
    q.currentIndex = 0;
    q.currentTrack = q.items[0];

    const { track, ended } = q.advance();
    expect(track?.title).toBe('B');
    expect(ended).toBe(false);
    expect(q.currentIndex).toBe(1);
  });

  it('advance loops back in queue mode', () => {
    q.add(makeTrack('A'), '<@1>');
    q.add(makeTrack('B'), '<@1>');
    q.currentIndex = 1;
    q.currentTrack = q.items[1];
    q.loopMode = 'queue';

    const { track, ended } = q.advance();
    expect(track?.title).toBe('A');
    expect(ended).toBe(false);
    expect(q.currentIndex).toBe(0);
  });

  it('advance repeats track in track mode', () => {
    q.add(makeTrack('A'), '<@1>');
    q.currentIndex = 0;
    q.currentTrack = q.items[0];
    q.loopMode = 'track';

    const { track, ended } = q.advance();
    expect(track?.title).toBe('A');
    expect(ended).toBe(false);
  });

  it('advance returns ended=true in none mode at last track', () => {
    q.add(makeTrack('A'), '<@1>');
    q.currentIndex = 0;
    q.currentTrack = q.items[0];
    q.loopMode = 'none';

    const { track, ended } = q.advance();
    expect(track).toBeNull();
    expect(ended).toBe(true);
  });

  // ── navigation: goBack ────────────────────────────────────────────────

  it('goBack moves to previous track', () => {
    q.add(makeTrack('A'), '<@1>');
    q.add(makeTrack('B'), '<@1>');
    q.currentIndex = 1;
    q.currentTrack = q.items[1];

    const t = q.goBack();
    expect(t?.title).toBe('A');
    expect(q.currentIndex).toBe(0);
  });

  it('goBack wraps to end in queue mode', () => {
    q.add(makeTrack('A'), '<@1>');
    q.add(makeTrack('B'), '<@1>');
    q.currentIndex = 0;
    q.currentTrack = q.items[0];
    q.loopMode = 'queue';

    const t = q.goBack();
    expect(t?.title).toBe('B');
    expect(q.currentIndex).toBe(1);
  });

  it('goBack returns null at start with no loop', () => {
    q.add(makeTrack('A'), '<@1>');
    q.currentIndex = 0;
    q.currentTrack = q.items[0];
    q.loopMode = 'none';

    expect(q.goBack()).toBeNull();
  });

  // ── jumpTo ────────────────────────────────────────────────────────────

  it('jumpTo sets cursor to a valid index', () => {
    q.add(makeTrack('A'), '<@1>');
    q.add(makeTrack('B'), '<@1>');
    const t = q.jumpTo(1);
    expect(t?.title).toBe('B');
    expect(q.currentIndex).toBe(1);
  });

  it('jumpTo returns null for invalid index', () => {
    expect(q.jumpTo(5)).toBeNull();
    expect(q.jumpTo(-1)).toBeNull();
  });

  // ── canSkip / canGoBack ───────────────────────────────────────────────

  it('canSkip true when next track exists', () => {
    q.add(makeTrack('A'), '<@1>');
    q.add(makeTrack('B'), '<@1>');
    q.currentIndex = 0;
    expect(q.canSkip()).toBe(true);
  });

  it('canSkip true in queue loop at end', () => {
    q.add(makeTrack('A'), '<@1>');
    q.currentIndex = 0;
    q.loopMode = 'queue';
    expect(q.canSkip()).toBe(true);
  });

  it('canSkip false in none mode at end', () => {
    q.add(makeTrack('A'), '<@1>');
    q.currentIndex = 0;
    q.loopMode = 'none';
    expect(q.canSkip()).toBe(false);
  });

  // ── loopMode ──────────────────────────────────────────────────────────

  it('setLoopMode accepts valid modes', () => {
    q.setLoopMode('track');
    expect(q.loopMode).toBe('track');
    q.setLoopMode('none');
    expect(q.loopMode).toBe('none');
    q.setLoopMode('queue');
    expect(q.loopMode).toBe('queue');
  });

  it('setLoopMode ignores invalid values', () => {
    q.setLoopMode('invalid');
    expect(q.loopMode).toBe('queue'); // default unchanged
  });

  // ── getFormatted ──────────────────────────────────────────────────────

  it('getFormatted returns decorated items', () => {
    q.add(makeTrack('A', 120), '<@1>');
    q.currentIndex = 0;
    q.currentTrack = q.items[0];

    const fmt = q.getFormatted();
    expect(fmt).toHaveLength(1);
    expect(fmt[0].position).toBe(1);
    expect(fmt[0].isCurrentlyPlaying).toBe(true);
  });
});
