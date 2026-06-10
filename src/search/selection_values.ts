/**
 * Search Selection Values
 * Encodes search results into select-menu option values that carry the
 * platform and video identity (e.g. "bili:BV1abc", "yt:dQw4w9WgXcQ"),
 * so selection handlers can reconstruct the video URL without re-searching.
 */

interface SelectableResult {
  title: string;
  uploader?: string;
  duration?: string | number;
  id?: string | number;
  bvid?: string;
  aid?: string | number;
  url?: string;
  [key: string]: unknown;
}

type SearchPlatform = 'bilibili' | 'youtube';

function extractBilibiliIdentity(result: SelectableResult): string | null {
  if (typeof result.bvid === 'string' && result.bvid.trim()) return result.bvid.trim();
  if (typeof result.aid === 'number' && Number.isFinite(result.aid)) return String(Math.trunc(result.aid));
  if (typeof result.aid === 'string' && result.aid.trim()) return result.aid.trim();

  if (typeof result.id === 'number' && Number.isFinite(result.id)) return String(Math.trunc(result.id));
  if (typeof result.id === 'string' && result.id.trim()) {
    const id = result.id.trim();
    if (/^(BV[a-zA-Z0-9]+|av\d+|\d+)$/.test(id)) return id;
  }

  if (typeof result.url === 'string') {
    const match = result.url.match(/\/video\/(BV[a-zA-Z0-9]+|av\d+)/i);
    if (match) return match[1];
  }

  return null;
}

function extractYouTubeIdentity(result: SelectableResult): string | null {
  if (typeof result.id === 'string' && /^[a-zA-Z0-9_-]{11}$/.test(result.id.trim())) {
    return result.id.trim();
  }

  if (typeof result.url === 'string') {
    const url = result.url.trim();
    if (/^[a-zA-Z0-9_-]{11}$/.test(url)) return url;

    const watchMatch = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
    if (watchMatch) return watchMatch[1];

    const pathMatch = url.match(/(?:youtu\.be\/|\/shorts\/|\/embed\/|\/live\/)([a-zA-Z0-9_-]{11})/);
    if (pathMatch) return pathMatch[1];
  }

  return null;
}

function createSelectionValue(platform: SearchPlatform, result: SelectableResult, fallback: string): string {
  const identity = platform === 'youtube'
    ? extractYouTubeIdentity(result)
    : extractBilibiliIdentity(result);
  return identity ? `${platform === 'youtube' ? 'yt' : 'bili'}:${identity}` : fallback;
}

export = {
  extractBilibiliIdentity,
  extractYouTubeIdentity,
  createSelectionValue,
};
