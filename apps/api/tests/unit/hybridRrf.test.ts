import { describe, it, expect } from 'vitest';
import { HybridStrategy } from '../../src/services/search/hybridStrategy.js';
import type { SearchQuery, SearchResult, SearchStrategy, QueryType } from '@web2x/shared';

class StubStrategy implements SearchStrategy {
  readonly name: QueryType;

  constructor(name: QueryType, private readonly results: SearchResult[]) {
    this.name = name;
  }

  supports(): boolean { return true; }
  score(r: SearchResult): number { return r.score; }

  async search(query: SearchQuery): Promise<SearchResult[]> {
    const limit = query.topK ?? this.results.length;
    return this.results.slice(0, limit);
  }
}

function mkResult(id: string, source: QueryType = 'bm25', score = 0.5): SearchResult {
  return {
    id,
    articleId: `article-${id}`,
    score,
    content: `content for ${id}`,
    metadata: { title: `title-${id}` },
    source,
  };
}

describe('HybridStrategy (RRF fusion)', () => {
  const baseQuery: SearchQuery = { text: 'q', workspaceId: 'ws' };

  it('returns empty array when both strategies return empty', async () => {
    const strat = new HybridStrategy([
      new StubStrategy('bm25', []),
      new StubStrategy('vector', []),
    ]);
    const results = await strat.search(baseQuery);
    expect(results).toEqual([]);
  });

  it('falls through cleanly when one strategy returns empty', async () => {
    const a = new StubStrategy('bm25', []);
    const b = new StubStrategy('vector', [mkResult('x', 'vector', 0.9), mkResult('y', 'vector', 0.5)]);
    const strat = new HybridStrategy([a, b]);
    const results = await strat.search(baseQuery);
    expect(results.map((r) => r.id)).toEqual(['x', 'y']);
    expect(results.every((r) => r.source === 'hybrid')).toBe(true);
  });

  it('deduplicates results across strategies by id', async () => {
    const a = new StubStrategy('bm25', [mkResult('shared'), mkResult('a-only')]);
    const b = new StubStrategy('vector', [mkResult('shared', 'vector'), mkResult('b-only', 'vector')]);
    const strat = new HybridStrategy([a, b]);
    const results = await strat.search(baseQuery);
    const ids = results.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('shared');
    expect(ids).toContain('a-only');
    expect(ids).toContain('b-only');
  });

  it('ranks shared documents higher than singletons', async () => {
    // "shared" appears at rank 0 in both strategies → gets max RRF boost
    const a = new StubStrategy('bm25', [mkResult('shared'), mkResult('a-only'), mkResult('a-tail')]);
    const b = new StubStrategy('vector', [mkResult('shared', 'vector'), mkResult('b-only', 'vector')]);
    const strat = new HybridStrategy([a, b]);
    const results = await strat.search(baseQuery);
    expect(results[0].id).toBe('shared');
  });

  it('uses configurable rrf_k from options', async () => {
    const a = new StubStrategy('bm25', [mkResult('a1'), mkResult('a2'), mkResult('a3')]);
    const b = new StubStrategy('vector', [mkResult('b1', 'vector'), mkResult('b2', 'vector')]);
    const strat = new HybridStrategy([a, b]);

    // With low rrf_k, top ranks dominate (less smoothing)
    const lowK = await strat.search({ ...baseQuery, options: { rrf_k: 1 } });
    // With high rrf_k, scores converge (more smoothing)
    const highK = await strat.search({ ...baseQuery, options: { rrf_k: 1000 } });

    // Both should still place rank-0 results first
    expect(lowK[0].id).toMatch(/^[ab]1$/);
    expect(highK[0].id).toMatch(/^[ab]1$/);
    // Score spread between top and last should be larger with low k
    const lowSpread = lowK[0].score - lowK[lowK.length - 1].score;
    const highSpread = highK[0].score - highK[highK.length - 1].score;
    expect(lowSpread).toBeGreaterThan(highSpread);
  });

  it('respects fused_top_k via options', async () => {
    const many = Array.from({ length: 20 }, (_, i) => mkResult(`d${i}`));
    const a = new StubStrategy('bm25', many);
    const b = new StubStrategy('vector', many.slice(5).map((r) => ({ ...r, source: 'vector' })));
    const strat = new HybridStrategy([a, b]);

    const result = await strat.search({ ...baseQuery, options: { fused_top_k: 3 } });
    expect(result).toHaveLength(3);
  });

  it('annotates all results with source: "hybrid"', async () => {
    const a = new StubStrategy('bm25', [mkResult('a')]);
    const b = new StubStrategy('vector', [mkResult('b', 'vector')]);
    const strat = new HybridStrategy([a, b]);
    const results = await strat.search(baseQuery);
    expect(results.every((r) => r.source === 'hybrid')).toBe(true);
  });

  it('normalises top score to 1.0', async () => {
    const a = new StubStrategy('bm25', [mkResult('x')]);
    const b = new StubStrategy('vector', [mkResult('x', 'vector')]);
    const strat = new HybridStrategy([a, b]);
    const results = await strat.search(baseQuery);
    expect(results[0].score).toBe(1);
  });
});
