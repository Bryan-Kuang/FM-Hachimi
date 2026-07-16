/**
 * Uploaded / pasted-link audio-file playback (Task 3.1).
 *
 * Attachments are already a direct, playable URL — there is no yt-dlp/native
 * extraction step. `buildAttachmentTrackData` builds the finished
 * ExtractedTrackData up front and marks it `cached: true`, which disables
 * BOTH refresh sites in src/audio/audio_player.ts (the lazy play-time
 * refresh at line ~579 and the CDN-retry refresh at line ~1069) — verified
 * safe since there is nothing to refresh: the Discord CDN URL either still
 * works or it has expired (~24h `ex=` param) and the track simply fails to
 * play, same as any other dead link.
 */

import type { ExtractedTrackData } from '../services/types';

export const ALLOWED_EXTENSIONS = ['mp3', 'm4a', 'ogg', 'oga', 'wav', 'flac', 'webm'];

export const ALLOWED_CONTENT_TYPES = [
  'audio/mpeg',
  'audio/mp4',
  'audio/x-m4a',
  'audio/ogg',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/flac',
  'audio/x-flac',
  'audio/webm',
];

/** Same Chrome UA used by every extractor in this repo (bilibili/extractor.ts, youtube/extractor.ts, playlist_coordinator.ts). */
const CHROME_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export interface AttachmentInput {
  url: string;
  name?: string | null;
  contentType?: string | null;
  size?: number | null;
}

export type AttachmentValidation = { ok: true } | { ok: false; reason: 'type' | 'size' };

/** pathname (NOT the raw URL) — Discord CDN URLs carry ?ex=&is=&hm= query params. */
function pathnameOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function basenameOf(pathname: string): string {
  const parts = pathname.split('/');
  return parts[parts.length - 1] || pathname;
}

function extensionOf(pathname: string): string {
  const match = basenameOf(pathname).match(/\.([a-z0-9]+)$/i);
  return match ? match[1].toLowerCase() : '';
}

/**
 * Validates an attachment's type (content-type or, failing that, file
 * extension) and size. Size is only enforced when known — a pasted Discord
 * CDN URL (as opposed to an uploaded file) carries no size, so it's allowed
 * through and simply fails at play time if it turns out to be too large.
 */
export function validateAttachment(attachment: AttachmentInput, maxBytes: number): AttachmentValidation {
  const contentTypeBase = attachment.contentType?.split(';')[0]?.trim().toLowerCase();
  const typeOk = Boolean(contentTypeBase && ALLOWED_CONTENT_TYPES.includes(contentTypeBase))
    || ALLOWED_EXTENSIONS.includes(extensionOf(pathnameOf(attachment.url)));

  if (!typeOk) {
    return { ok: false, reason: 'type' };
  }

  if (attachment.size != null && attachment.size > maxBytes) {
    return { ok: false, reason: 'size' };
  }

  return { ok: true };
}

/**
 * Builds the finished (non-pending) ExtractedTrackData for an attachment.
 * No `platform` / `normalizedUrl` / `bvid` — with `cached: true` no refresh
 * path ever consults them.
 */
export function buildAttachmentTrackData(attachment: AttachmentInput): ExtractedTrackData {
  const pathname = pathnameOf(attachment.url);
  const rawTitle = attachment.name ?? decodeURIComponent(basenameOf(pathname));
  const title = rawTitle.replace(/\.[a-z0-9]+$/i, '');

  return {
    title,
    audioUrl: attachment.url,
    duration: 0,
    extractedAt: new Date().toISOString(),
    cached: true,
    streamHeaders: { referer: 'https://discord.com/', userAgent: CHROME_USER_AGENT },
  };
}
