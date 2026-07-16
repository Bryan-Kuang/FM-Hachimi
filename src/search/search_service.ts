import SearchRanker = require('../utils/search_ranker');
import * as logger from '../services/logger_service';
import type { SpotifySearchResult } from '../spotify/types';

interface SearchVideo {
  id?: string;
  bvid?: string;
  title: string;
  url?: string;
  duration?: number | string;
  author?: string;
  uploader?: string;
  view?: number;
  viewCount?: number;
  [key: string]: unknown;
}

interface SearchResponseShape {
  success?: boolean;
  results?: SearchVideo[];
}

interface SearcherLike {
  searchVideos: (...args: unknown[]) => Promise<SearchResponseShape | SearchVideo[]>;
}

interface SearchOptions {
  keyword: string;
  limit: number;
  extractor?: SearcherLike | null;
  bilibiliApi?: SearcherLike | null;
  source?: 'extractor' | 'api';
}

interface YouTubeSearchOptions {
  keyword: string;
  limit: number;
  youtubeExtractor?: SearcherLike | null;
}

interface DualSearchOptions {
  keyword: string;
  limitPerPlatform: number;
  bilibiliApi?: SearcherLike | null;
  youtubeExtractor?: SearcherLike | null;
}

interface DualSearchResult {
  bilibili: SearchVideo[];
  youtube: SearchVideo[];
  rawBilibiliCount: number;
  rawYouTubeCount: number;
}

interface SpotifySearcherLike {
  searchTracks(keyword: string, limit: number): Promise<SpotifySearchResult[]>;
}

interface TriSearchOptions {
  keyword: string;
  limitPerPlatform: number;
  bilibiliApi?: SearcherLike | null;
  youtubeExtractor?: SearcherLike | null;
  spotifyClient?: SpotifySearcherLike | null;
}

interface TriSearchResult {
  bilibili: SearchVideo[];
  youtube: SearchVideo[];
  spotify: SpotifySearchResult[];
  rawBilibiliCount: number;
  rawYouTubeCount: number;
}

function responseToArray(response: SearchResponseShape | SearchVideo[] | null | undefined): SearchVideo[] {
  if (Array.isArray(response)) return response;
  if (response && Array.isArray(response.results)) return response.results;
  return [];
}

function normalizeBilibiliResult(result: SearchVideo): SearchVideo {
  return {
    ...result,
    uploader: result.uploader || result.author || 'Unknown',
    viewCount: result.viewCount ?? result.view ?? 0,
  };
}

function rankAndLimit(results: SearchVideo[], keyword: string, limit: number): SearchVideo[] {
  return SearchRanker.rankAndLimitSearchResults(results, keyword, limit) as SearchVideo[];
}

async function searchBilibili({
  keyword,
  limit,
  extractor,
  bilibiliApi,
  source = 'extractor',
}: SearchOptions): Promise<SearchVideo[]> {
  try {
    const response = source === 'api'
      ? await bilibiliApi?.searchVideos(keyword, 1, limit)
      : await extractor?.searchVideos(keyword, limit);
    const normalized = responseToArray(response).map(normalizeBilibiliResult);
    return rankAndLimit(normalized, keyword, limit);
  } catch {
    return [];
  }
}

async function searchYouTube({
  keyword,
  limit,
  youtubeExtractor,
}: YouTubeSearchOptions): Promise<SearchVideo[]> {
  try {
    const response = await youtubeExtractor?.searchVideos(keyword, limit);
    return rankAndLimit(responseToArray(response), keyword, limit);
  } catch {
    return [];
  }
}

async function searchDualPlatforms({
  keyword,
  limitPerPlatform,
  bilibiliApi,
  youtubeExtractor,
}: DualSearchOptions): Promise<DualSearchResult> {
  const [bilibiliRaw, youtubeRaw] = await Promise.all([
    (async () => {
      try {
        return responseToArray(await bilibiliApi?.searchVideos(keyword, 1, limitPerPlatform)).map(normalizeBilibiliResult);
      } catch {
        return [];
      }
    })(),
    (async () => {
      try {
        return responseToArray(await youtubeExtractor?.searchVideos(keyword, limitPerPlatform));
      } catch {
        return [];
      }
    })(),
  ]);

  return {
    bilibili: rankAndLimit(bilibiliRaw, keyword, limitPerPlatform),
    youtube: rankAndLimit(youtubeRaw, keyword, limitPerPlatform),
    rawBilibiliCount: bilibiliRaw.length,
    rawYouTubeCount: youtubeRaw.length,
  };
}

/**
 * Concurrent tri-platform keyword search (Bilibili + YouTube + Spotify).
 * `Promise.allSettled` so one platform's failure (or `null`/absent client,
 * e.g. Spotify disabled) never blocks the others — a rejected/absent
 * platform simply contributes an empty list, logged at warn.
 */
async function searchTriPlatforms({
  keyword,
  limitPerPlatform,
  bilibiliApi,
  youtubeExtractor,
  spotifyClient,
}: TriSearchOptions): Promise<TriSearchResult> {
  const [bilibiliOutcome, youtubeOutcome, spotifyOutcome] = await Promise.allSettled([
    (async () => responseToArray(await bilibiliApi?.searchVideos(keyword, 1, limitPerPlatform)).map(normalizeBilibiliResult))(),
    (async () => responseToArray(await youtubeExtractor?.searchVideos(keyword, limitPerPlatform)))(),
    (async () => (spotifyClient ? spotifyClient.searchTracks(keyword, limitPerPlatform) : []))(),
  ]);

  const bilibiliRaw = bilibiliOutcome.status === 'fulfilled' ? bilibiliOutcome.value : [];
  const youtubeRaw = youtubeOutcome.status === 'fulfilled' ? youtubeOutcome.value : [];
  const spotifyRaw = spotifyOutcome.status === 'fulfilled' ? spotifyOutcome.value : [];

  if (bilibiliOutcome.status === 'rejected') {
    logger.warn('Bilibili search failed during tri-platform search', { keyword, error: (bilibiliOutcome.reason as Error)?.message });
  }
  if (youtubeOutcome.status === 'rejected') {
    logger.warn('YouTube search failed during tri-platform search', { keyword, error: (youtubeOutcome.reason as Error)?.message });
  }
  if (spotifyOutcome.status === 'rejected') {
    logger.warn('Spotify search failed during tri-platform search', { keyword, error: (spotifyOutcome.reason as Error)?.message });
  }

  return {
    bilibili: rankAndLimit(bilibiliRaw, keyword, limitPerPlatform),
    youtube: rankAndLimit(youtubeRaw, keyword, limitPerPlatform),
    spotify: spotifyRaw.slice(0, limitPerPlatform),
    rawBilibiliCount: bilibiliRaw.length,
    rawYouTubeCount: youtubeRaw.length,
  };
}

export = {
  normalizeBilibiliResult,
  responseToArray,
  searchBilibili,
  searchYouTube,
  searchDualPlatforms,
  searchTriPlatforms,
};
