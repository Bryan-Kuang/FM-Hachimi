type SearchCandidate = {
  title?: unknown;
};

class SearchRanker {
  static normalizeSearchText(value: unknown): string {
    if (value === null || value === undefined) return '';
    const withoutHtml = String(value).replace(/<[^>]*>/g, '');
    return withoutHtml
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[\s\p{P}\p{S}_]+/gu, '');
  }

  static rankAndLimitSearchResults<T extends SearchCandidate>(
    results: T[],
    keyword: string,
    limit: number,
  ): T[] {
    const safeLimit = Math.max(0, Math.floor(limit));
    if (!Array.isArray(results) || safeLimit === 0) return [];

    const query = this.normalizeSearchText(keyword);
    if (!query) return results.slice(0, safeLimit);

    const scored = results
      .map((result, index) => ({
        result,
        score: this.scoreSearchResult(result, query),
        index,
      }))
      .sort((a, b) => b.score - a.score || a.index - b.index);

    return scored.slice(0, safeLimit).map(item => item.result);
  }

  private static scoreSearchResult(result: SearchCandidate, normalizedQuery: string): number {
    const title = this.normalizeSearchText(result.title);
    const signals = this.querySignals(normalizedQuery);

    return this.scoreText(title, normalizedQuery, signals);
  }

  private static querySignals(normalizedQuery: string): string[] {
    if (normalizedQuery.length <= 2) return [normalizedQuery];

    const signals = new Set<string>();
    for (let i = 0; i < normalizedQuery.length - 1; i++) {
      signals.add(normalizedQuery.slice(i, i + 2));
    }
    return Array.from(signals);
  }

  private static scoreText(
    normalizedText: string,
    normalizedQuery: string,
    signals: string[],
  ): number {
    if (!normalizedText) return 0;

    let score = 0;
    if (normalizedText === normalizedQuery) score += 10000;
    if (normalizedText.includes(normalizedQuery)) {
      const positionBonus = Math.max(0, 500 - normalizedText.indexOf(normalizedQuery));
      score += 6000 + positionBonus;
    }
    if (normalizedQuery.includes(normalizedText) && normalizedText.length >= 3) {
      score += 800;
    }

    const matchedSignals = signals.filter(signal => normalizedText.includes(signal)).length;
    if (matchedSignals > 0) {
      const coverage = matchedSignals / signals.length;
      score += coverage * 1200 + matchedSignals * 10;
    }

    return score;
  }
}

export = SearchRanker;
