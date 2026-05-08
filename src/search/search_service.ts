import SearchRanker = require('../utils/search_ranker');

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

export = {
  normalizeBilibiliResult,
  responseToArray,
  searchBilibili,
  searchYouTube,
  searchDualPlatforms,
};
