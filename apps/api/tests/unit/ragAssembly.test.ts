import { describe, it, expect } from 'vitest';
import { assembleRagContext } from '../../src/services/search/ragStrategy.js';
import type { SearchResult, QueryType } from '@web2x/shared';

function mkResult(opts: {
  id: string;
  articleId: string;
  title?: string;
  content: string;
}): SearchResult {
  return {
    id: opts.id,
    articleId: opts.articleId,
    score: 0.5,
    content: opts.content,
    metadata: { title: opts.title ?? 'Untitled' },
    source: 'vector' as QueryType,
  };
}

describe('assembleRagContext', () => {
  it('returns empty context and no sources for an empty result list', () => {
    const { context, sources } = assembleRagContext([]);
    expect(context).toBe('');
    expect(sources).toEqual([]);
  });

  it('groups multiple chunks of the same article under one heading', () => {
    const results = [
      mkResult({ id: 'c1', articleId: 'a1', title: 'First', content: 'chunk one' }),
      mkResult({ id: 'c2', articleId: 'a1', title: 'First', content: 'chunk two' }),
    ];
    const { context, sources } = assembleRagContext(results);
    expect(context).toContain('## First');
    expect(context).toContain('chunk one');
    expect(context).toContain('chunk two');
    // Title should appear only once (one heading per article)
    expect(context.match(/## First/g)).toHaveLength(1);
    expect(sources).toEqual([{ articleId: 'a1', title: 'First' }]);
  });

  it('produces one source per unique article', () => {
    const results = [
      mkResult({ id: 'c1', articleId: 'a1', title: 'First', content: 'one' }),
      mkResult({ id: 'c2', articleId: 'a2', title: 'Second', content: 'two' }),
      mkResult({ id: 'c3', articleId: 'a1', title: 'First', content: 'three' }),
    ];
    const { sources } = assembleRagContext(results);
    expect(sources).toHaveLength(2);
    expect(sources.map((s) => s.articleId)).toEqual(['a1', 'a2']);
  });

  it('respects maxContextChars cap and stops adding article blocks', () => {
    const longContent = 'x'.repeat(200);
    const results = [
      mkResult({ id: 'c1', articleId: 'a1', title: 'A', content: longContent }),
      mkResult({ id: 'c2', articleId: 'a2', title: 'B', content: longContent }),
      mkResult({ id: 'c3', articleId: 'a3', title: 'C', content: longContent }),
    ];
    // Cap small enough that only one article fits
    const { context, sources } = assembleRagContext(results, 250);
    expect(sources.length).toBeLessThan(3);
    expect(context.length).toBeLessThanOrEqual(250);
  });

  it('falls back to "Untitled" when title metadata is missing', () => {
    const r: SearchResult = {
      id: 'c1',
      articleId: 'a1',
      score: 0.5,
      content: 'hello',
      metadata: {},
      source: 'vector',
    };
    const { context, sources } = assembleRagContext([r]);
    expect(context).toContain('## Untitled');
    expect(sources[0].title).toBe('Untitled');
  });
});
