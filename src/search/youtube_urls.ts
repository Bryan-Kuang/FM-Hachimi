interface YouTubeResultLike {
  id?: string;
  url?: string;
  webpage_url?: string;
}

const YOUTUBE_VIDEO_ID = /^[a-zA-Z0-9_-]{11}$/;

function toWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

function extractYouTubeVideoId(value?: string): string | null {
  if (!value || typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (YOUTUBE_VIDEO_ID.test(trimmed)) return trimmed;

  const watchMatch = trimmed.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (watchMatch) return watchMatch[1];

  const pathMatch = trimmed.match(/(?:youtu\.be\/|\/shorts\/|\/embed\/|\/live\/)([a-zA-Z0-9_-]{11})/);
  if (pathMatch) return pathMatch[1];

  return null;
}

function toYouTubeUrl(result: YouTubeResultLike): string | null {
  const videoId =
    extractYouTubeVideoId(result.id) ||
    extractYouTubeVideoId(result.webpage_url) ||
    extractYouTubeVideoId(result.url);

  return videoId ? toWatchUrl(videoId) : null;
}

function collectYouTubeUrls(results: YouTubeResultLike[], limit: number): string[] {
  return results
    .slice(0, Math.max(0, limit))
    .map(toYouTubeUrl)
    .filter((url): url is string => Boolean(url));
}

export = {
  collectYouTubeUrls,
};
