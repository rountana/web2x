import type { SearchQuery, SearchResult, SearchStrategy, QueryType } from '@web2x/shared';

export class HybridStrategy implements SearchStrategy {
  readonly name: QueryType = 'hybrid';

  constructor(
    private readonly strategies: SearchStrategy[],
    private readonly defaultRrfK: number = 60,
  ) {}

  supports(queryType: QueryType): boolean {
    return queryType === 'hybrid';
  }

  score(result: SearchResult): number {
    return result.score;
  }

  async search(query: SearchQuery): Promise<SearchResult[]> {
    const rrfK = (query.options?.rrf_k as number) ?? this.defaultRrfK;
    const perStrategyK = (query.options?.rrf_per_strategy_k as number) ?? 10;
    const fusedTopK = (query.options?.fused_top_k as number) ?? (query.topK ?? 8);

    // Fetch from all strategies in parallel using a higher topK for better fusion coverage
    const allResults = await Promise.all(
      this.strategies.map((s) => s.search({ ...query, topK: perStrategyK })),
    );

    // Compute RRF score: for each result sum  1 / (k + rank)  across all result lists
    const rrfScores = new Map<string, number>();
    const resultById = new Map<string, SearchResult>();

    for (const results of allResults) {
      for (let rank = 0; rank < results.length; rank++) {
        const result = results[rank];
        rrfScores.set(result.id, (rrfScores.get(result.id) ?? 0) + 1 / (rrfK + rank + 1));
        if (!resultById.has(result.id)) {
          resultById.set(result.id, result);
        }
      }
    }

    const sorted = [...rrfScores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, fusedTopK);

    if (sorted.length === 0) return [];

    const maxScore = sorted[0][1];

    return sorted.map(([id, rrfScore]) => ({
      ...resultById.get(id)!,
      score: rrfScore / maxScore,
      source: 'hybrid' as QueryType,
    }));
  }
}
