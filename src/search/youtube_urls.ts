interface YouTubeResultLike {
  id?: string;
  url?: string;
  webpage_url?: string;
}

function toYouTubeUrl(result: YouTubeResultLike): string | null {
  if (result.url) return result.url;
  if (result.webpage_url) return result.webpage_url;
  if (result.id) return `https://www.youtube.com/watch?v=${result.id}`;
  return null;
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
