/**
 * URL Router
 * Dispatches URLs to the appropriate platform extractor.
 * Falls back to keyword search when no URL pattern matches.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import BilibiliValidator = require('../bilibili/validator');
import YouTubeValidator = require('../youtube/validator');
import * as logger from '../services/logger_service';

export type Platform = 'bilibili' | 'youtube' | 'unknown';

export type RouteKind =
  | 'bilibili-video'
  | 'youtube-video'
  | 'youtube-playlist'
  | 'bilibili-fav'
  | 'bilibili-collection'
  | 'attachment'
  | 'unknown-url'
  | 'keyword';

export interface RouteResult {
  platform: Platform;
  isUrl: boolean;
  /** Normalized URL (null if input is a keyword, not a URL) */
  normalizedUrl: string | null;
  /** Original input */
  raw: string;
  /** Fine-grained classification beyond `platform` (playlists, attachments, …). */
  kind: RouteKind;
  youtubePlaylist?: { listId: string };
  bilibiliFav?: { mediaId: string };
  bilibiliCollection?: { mid: string; seasonId: string; listType: 'season' | 'series' };
}

const DISCORD_ATTACHMENT_PATTERN = /^https?:\/\/(?:cdn|media)\.discordapp\.(?:com|net)\/attachments\//i;

const BILIBILI_FAVLIST_PATTERN = /(?:https?:\/\/)?space\.bilibili\.com\/\d+\/favlist\?(?:[^#]*&)?fid=(\d+)/;
const BILIBILI_MEDIALIST_PATTERN = /(?:https?:\/\/)?(?:www\.)?bilibili\.com\/medialist\/(?:detail|play)\/ml(\d+)/;

const BILIBILI_COLLECTION_OLD_PATTERN = /space\.bilibili\.com\/(\d+)\/channel\/collectiondetail\?(?:[^#]*&)?sid=(\d+)/;
const BILIBILI_COLLECTION_NEW_PATTERN = /space\.bilibili\.com\/(\d+)\/lists\/(\d+)/;

const YOUTUBE_PLAYLIST_PATTERN = /(?:https?:\/\/)?(?:www\.|music\.)?youtube\.com\/playlist\?(?:[^#]*&)?list=([A-Za-z0-9_-]+)/;

/**
 * Determine which platform a URL belongs to, or mark it as a keyword search.
 */
export function routeQuery(query: string): RouteResult {
  if (!query || typeof query !== 'string') {
    return { platform: 'unknown', isUrl: false, normalizedUrl: null, raw: query, kind: 'keyword' };
  }

  const trimmed = query.trim();

  // Discord CDN attachment link (pasted rather than uploaded via the file option).
  if (DISCORD_ATTACHMENT_PATTERN.test(trimmed)) {
    return {
      platform: 'unknown',
      isUrl: true,
      normalizedUrl: trimmed,
      raw: trimmed,
      kind: 'attachment',
    };
  }

  // Bilibili favorites folder (收藏夹).
  const favMatch = trimmed.match(BILIBILI_FAVLIST_PATTERN) || trimmed.match(BILIBILI_MEDIALIST_PATTERN);
  if (favMatch) {
    return {
      platform: 'bilibili',
      isUrl: true,
      normalizedUrl: trimmed,
      raw: trimmed,
      kind: 'bilibili-fav',
      bilibiliFav: { mediaId: favMatch[1] },
    };
  }

  // Bilibili collection (合集/系列) — old collectiondetail path or new /lists/ path.
  const collectionOldMatch = trimmed.match(BILIBILI_COLLECTION_OLD_PATTERN);
  if (collectionOldMatch) {
    return {
      platform: 'bilibili',
      isUrl: true,
      normalizedUrl: trimmed,
      raw: trimmed,
      kind: 'bilibili-collection',
      bilibiliCollection: { mid: collectionOldMatch[1], seasonId: collectionOldMatch[2], listType: 'season' },
    };
  }
  const collectionNewMatch = trimmed.match(BILIBILI_COLLECTION_NEW_PATTERN);
  if (collectionNewMatch) {
    return {
      platform: 'bilibili',
      isUrl: true,
      normalizedUrl: trimmed,
      raw: trimmed,
      kind: 'bilibili-collection',
      bilibiliCollection: {
        mid: collectionNewMatch[1],
        seasonId: collectionNewMatch[2],
        listType: trimmed.includes('type=series') ? 'series' : 'season',
      },
    };
  }

  // YouTube playlist — only pure playlist paths. `watch?v=X&list=Y` falls
  // through to the existing YouTube video check below (v= wins; the
  // validator strips list= and plays the single video, unchanged behavior).
  const youtubePlaylistMatch = trimmed.match(YOUTUBE_PLAYLIST_PATTERN);
  if (youtubePlaylistMatch) {
    return {
      platform: 'youtube',
      isUrl: true,
      normalizedUrl: trimmed,
      raw: trimmed,
      kind: 'youtube-playlist',
      youtubePlaylist: { listId: youtubePlaylistMatch[1] },
    };
  }

  // Check Bilibili first (existing primary platform)
  if (BilibiliValidator.isValidBilibiliUrl(trimmed)) {
    return {
      platform: 'bilibili',
      isUrl: true,
      normalizedUrl: BilibiliValidator.normalizeUrl(trimmed),
      raw: trimmed,
      kind: 'bilibili-video',
    };
  }

  // Check YouTube
  if (YouTubeValidator.isValidYouTubeUrl(trimmed)) {
    return {
      platform: 'youtube',
      isUrl: true,
      normalizedUrl: YouTubeValidator.normalizeUrl(trimmed),
      raw: trimmed,
      kind: 'youtube-video',
    };
  }

  // Looks like a URL but doesn't match any platform
  if (/^https?:\/\//i.test(trimmed)) {
    logger.warn('URL does not match any supported platform', { url: trimmed });
    return { platform: 'unknown', isUrl: true, normalizedUrl: null, raw: trimmed, kind: 'unknown-url' };
  }

  // Keyword search (not a URL)
  return { platform: 'unknown', isUrl: false, normalizedUrl: null, raw: trimmed, kind: 'keyword' };
}
