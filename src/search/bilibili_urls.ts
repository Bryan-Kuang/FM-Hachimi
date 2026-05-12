interface BilibiliResultLike {
  bvid?: string;
  aid?: string | number;
  id?: string | number;
  url?: string;
}

function toBilibiliUrl(result: BilibiliResultLike): string | null {
  if (typeof result.url === 'string' && result.url.trim()) {
    return result.url.trim();
  }

  if (typeof result.bvid === 'string' && result.bvid.trim()) {
    return `https://www.bilibili.com/video/${result.bvid.trim()}`;
  }

  if (typeof result.aid === 'number' && Number.isFinite(result.aid)) {
    return `https://www.bilibili.com/video/av${Math.trunc(result.aid)}`;
  }

  if (typeof result.aid === 'string' && result.aid.trim()) {
    const aid = result.aid.trim().replace(/^av/i, '');
    if (/^\d+$/.test(aid)) return `https://www.bilibili.com/video/av${aid}`;
  }

  if (typeof result.id === 'number' && Number.isFinite(result.id)) {
    return `https://www.bilibili.com/video/av${Math.trunc(result.id)}`;
  }

  if (typeof result.id === 'string' && result.id.trim()) {
    const id = result.id.trim();
    if (/^BV[a-zA-Z0-9]+$/.test(id)) return `https://www.bilibili.com/video/${id}`;
    if (/^av\d+$/i.test(id)) return `https://www.bilibili.com/video/av${id.replace(/^av/i, '')}`;
    if (/^\d+$/.test(id)) return `https://www.bilibili.com/video/av${id}`;
  }

  return null;
}

function collectBilibiliUrls(results: BilibiliResultLike[], limit?: number): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  const safeResults = Array.isArray(results) ? results : [];
  const max = limit ?? safeResults.length;

  for (const result of safeResults) {
    if (urls.length >= max) break;
    const url = toBilibiliUrl(result);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }

  return urls;
}

export = {
  collectBilibiliUrls,
  toBilibiliUrl,
};
