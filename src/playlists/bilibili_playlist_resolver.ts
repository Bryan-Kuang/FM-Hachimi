/**
 * Bilibili favorites (收藏夹), collection (合集/系列), and multipart (分P)
 * sources → ResolvedPlaylist. Pagination loops live here — src/bilibili/api.ts
 * only fetches and shapes one page/response at a time.
 */

import type { ResolvedPlaylist, PlaylistItem, PlaylistProgress } from './types';

/** Hard safety cap on pagination loops — real folders/collections never get
 * remotely this deep; guards against an API bug returning hasMore forever. */
const MAX_PAGES = 500;

interface FavFolderItemLike {
  bvid: string;
  title: string;
  durationSec: number;
  author: string;
  cover: string;
}

interface CollectionItemLike {
  bvid: string;
  title: string;
  durationSec: number;
  cover: string;
}

interface VideoPageEntryLike {
  page: number;
  part: string;
  durationSec: number;
  cid: number;
}

interface BilibiliApiLike {
  getFavFolderPage(mediaId: string, pn: number, ps?: number): Promise<{
    title: string;
    mediaCount: number;
    hasMore: boolean;
    items: FavFolderItemLike[];
  }>;
  getCollectionPage(
    mid: string,
    seasonId: string,
    pageNum: number,
    listType: 'season' | 'series',
    ps?: number,
  ): Promise<{
    title: string;
    total: number;
    items: CollectionItemLike[];
  }>;
  getVideoPages(bvid: string): Promise<{
    title: string;
    pages: VideoPageEntryLike[];
  }>;
}

export interface ResolveBilibiliFavOptions {
  mediaId: string;
  api: BilibiliApiLike;
  maxItems: number;
  onProgress?: PlaylistProgress;
}

export async function resolveBilibiliFav({
  mediaId,
  api,
  maxItems,
  onProgress,
}: ResolveBilibiliFavOptions): Promise<ResolvedPlaylist> {
  const items: PlaylistItem[] = [];
  let title = '';
  let mediaCount = 0;
  let hasMore = true;
  let pn = 1;

  while (hasMore && items.length < maxItems && pn <= MAX_PAGES) {
    const page = await api.getFavFolderPage(mediaId, pn, 20);
    if (pn === 1) {
      title = page.title;
      mediaCount = page.mediaCount;
    }

    for (const media of page.items) {
      if (items.length >= maxItems) break;
      items.push({
        url: `https://www.bilibili.com/video/${media.bvid}`,
        title: media.title,
        durationSec: media.durationSec,
        platform: 'bilibili',
        author: media.author,
        thumbnail: media.cover,
      });
    }

    hasMore = page.hasMore;
    onProgress?.(items.length, mediaCount);
    pn++;
  }

  return {
    kind: 'bilibili-fav',
    title,
    items,
    totalCount: mediaCount,
    truncated: items.length < mediaCount,
  };
}

export interface ResolveBilibiliCollectionOptions {
  mid: string;
  seasonId: string;
  listType: 'season' | 'series';
  api: BilibiliApiLike;
  maxItems: number;
  onProgress?: PlaylistProgress;
}

export async function resolveBilibiliCollection({
  mid,
  seasonId,
  listType,
  api,
  maxItems,
  onProgress,
}: ResolveBilibiliCollectionOptions): Promise<ResolvedPlaylist> {
  const items: PlaylistItem[] = [];
  let title = '';
  let total = Infinity; // unknown until the first page reports it
  let pageNum = 1;

  while (items.length < Math.min(total, maxItems) && pageNum <= MAX_PAGES) {
    const page = await api.getCollectionPage(mid, seasonId, pageNum, listType, 30);
    if (pageNum === 1) {
      title = page.title;
      total = page.total;
    }
    if (page.items.length === 0) break;

    for (const entry of page.items) {
      if (items.length >= maxItems) break;
      items.push({
        url: `https://www.bilibili.com/video/${entry.bvid}`,
        title: entry.title,
        durationSec: entry.durationSec,
        platform: 'bilibili',
        thumbnail: entry.cover,
      });
    }

    onProgress?.(items.length, total);
    pageNum++;
  }

  return {
    kind: 'bilibili-collection',
    title,
    items,
    totalCount: Number.isFinite(total) ? total : items.length,
    truncated: items.length < total,
  };
}

export interface ResolveBilibiliMultipartOptions {
  bvid: string;
  api: BilibiliApiLike;
  maxItems: number;
}

export async function resolveBilibiliMultipart({
  bvid,
  api,
  maxItems,
}: ResolveBilibiliMultipartOptions): Promise<ResolvedPlaylist> {
  const result = await api.getVideoPages(bvid);
  const pages = result.pages.slice(0, maxItems);

  const items: PlaylistItem[] = pages.map((p) => ({
    url: `https://www.bilibili.com/video/${bvid}?p=${p.page}`,
    title: `${result.title} P${p.page} ${p.part}`.trim(),
    durationSec: p.durationSec,
    platform: 'bilibili',
  }));

  return {
    kind: 'bilibili-multipart',
    title: result.title,
    items,
    totalCount: result.pages.length,
    truncated: result.pages.length > items.length,
  };
}
