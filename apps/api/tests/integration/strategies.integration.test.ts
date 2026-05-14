/**
 * Integration tests — execute real SQL against the dev DB.
 *
 * These tests catch regressions that mocks would miss:
 *   - SQL syntax / join ordering bugs (BM25 had one in 2026-05-04 incident)
 *   - tsvector index actually populated
 *   - JSONB metadata predicates resolve correctly
 *   - workspace scoping enforced
 *
 * Setup: each test seeds its own workspace + articles in `beforeAll` and
 * deletes them in `afterAll` (cascade removes chunks). Tests are NOT parallel
 * within this file — vitest's `singleFork` config plus `describe.sequential`
 * keeps the dev DB consistent.
 *
 * Skipped automatically if DATABASE_URL is not set (e.g. CI without a DB).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

const hasDb = !!process.env.DATABASE_URL;

// Use describe.skipIf so the suite is silently skipped when DB is unavailable
const d = hasDb ? describe : describe.skip;

d('Search strategies — integration (real DB)', () => {
  let db: typeof import('../../src/db/client.js')['db'];
  let articles: typeof import('../../src/db/schema.js')['articles'];
  let articleChunks: typeof import('../../src/db/schema.js')['articleChunks'];
  let workspaces: typeof import('../../src/db/schema.js')['workspaces'];
  let csvUploads: typeof import('../../src/db/schema.js')['csvUploads'];
  let csvRows: typeof import('../../src/db/schema.js')['csvRows'];

  let BM25Strategy: typeof import('../../src/services/search/bm25Strategy.js')['BM25Strategy'];
  let MetadataStrategy: typeof import('../../src/services/search/metadataStrategy.js')['MetadataStrategy'];
  let CsvStrategy: typeof import('../../src/services/search/csvStrategy.js')['CsvStrategy'];

  // Test workspace + seed content
  const workspaceId = randomUUID();
  const userId = `test-user-${randomUUID().slice(0, 8)}`;

  const articleA_id = randomUUID();
  const articleB_id = randomUUID();
  const articleC_id = randomUUID();

  beforeAll(async () => {
    // Lazy-import so the suite can be skipped without crashing on env-load
    ({ db } = await import('../../src/db/client.js'));
    ({ articles, articleChunks, workspaces, csvUploads, csvRows } = await import(
      '../../src/db/schema.js'
    ));
    ({ BM25Strategy } = await import('../../src/services/search/bm25Strategy.js'));
    ({ MetadataStrategy } = await import(
      '../../src/services/search/metadataStrategy.js'
    ));
    ({ CsvStrategy } = await import('../../src/services/search/csvStrategy.js'));

    await db.insert(workspaces).values({ id: workspaceId, userId, name: 'test-workspace' });

    const yearAgo = new Date(Date.now() - 365 * 86_400_000);
    const today = new Date();

    await db.insert(articles).values([
      {
        id: articleA_id,
        workspaceId,
        sourceUrl: 'https://example.com/a',
        title: 'Vector Search with HNSW',
        markdownContent:
          'pgvector supports HNSW indexes for approximate nearest neighbor search. ' +
          'It is used for semantic retrieval in RAG pipelines.',
        wordCount: 25,
        status: 'ready',
        createdAt: today,
      },
      {
        id: articleB_id,
        workspaceId,
        sourceUrl: 'https://example.com/b',
        title: 'BM25 Keyword Ranking',
        markdownContent:
          'Okapi BM25 ranks documents by term frequency, inverse document frequency, ' +
          'and length normalization. PostgreSQL ts_rank_cd approximates BM25.',
        wordCount: 22,
        status: 'ready',
        createdAt: today,
      },
      {
        id: articleC_id,
        workspaceId,
        sourceUrl: 'https://example.com/c',
        title: 'A very old article',
        markdownContent: 'this content should never match the test queries about pgvector',
        wordCount: 10,
        status: 'ready',
        createdAt: yearAgo,
      },
    ]);

    await db.insert(articleChunks).values([
      {
        articleId: articleA_id,
        chunkIndex: 0,
        content: 'pgvector supports HNSW indexes for approximate nearest neighbor search.',
      },
      {
        articleId: articleA_id,
        chunkIndex: 1,
        content: 'It is used for semantic retrieval in RAG pipelines.',
      },
      {
        articleId: articleB_id,
        chunkIndex: 0,
        content: 'Okapi BM25 ranks documents by term frequency and inverse document frequency.',
      },
      {
        articleId: articleB_id,
        chunkIndex: 1,
        content: 'PostgreSQL ts_rank_cd approximates BM25 ranking.',
      },
      {
        articleId: articleC_id,
        chunkIndex: 0,
        content: 'unrelated content about cats and dogs',
      },
    ]);

    // Wait briefly for the STORED tsvector column to be populated
    // (it is synchronous but defensive)
    await db.execute(sql`SELECT 1`);
  });

  afterAll(async () => {
    if (!db) return;
    // Cascade deletes chunks, csv_rows
    await db.execute(sql`DELETE FROM workspaces WHERE id = ${workspaceId}::uuid`);
  });

  describe('BM25Strategy', () => {
    it('finds chunks for a single keyword query', async () => {
      const strat = new BM25Strategy();
      const results = await strat.search({
        text: 'pgvector',
        workspaceId,
      });
      expect(results.length).toBeGreaterThan(0);
      expect(results.every((r) => r.source === 'bm25')).toBe(true);
      const articleIds = new Set(results.map((r) => r.articleId));
      expect(articleIds.has(articleA_id)).toBe(true);
    });

    it('handles a multi-word query without SQL errors (regression: 2026-05-04 join bug)', async () => {
      const strat = new BM25Strategy();
      // This is the exact shape that used to fail with "missing FROM-clause" before the
      // join was reordered. The fix is in bm25Strategy.ts; this test prevents regression.
      const results = await strat.search({
        text: 'BM25 ranking documents',
        workspaceId,
      });
      // Must not throw, and must return at least the BM25-themed article
      const articleIds = new Set(results.map((r) => r.articleId));
      expect(articleIds.has(articleB_id)).toBe(true);
    });

    it('returns empty array for queries that match nothing', async () => {
      const strat = new BM25Strategy();
      const results = await strat.search({
        text: 'xyzzqqplover',
        workspaceId,
      });
      expect(results).toEqual([]);
    });

    it('handles queries that resolve to all stop words without crashing', async () => {
      const strat = new BM25Strategy();
      const results = await strat.search({
        text: 'the a is for',
        workspaceId,
      });
      // Either empty or non-empty — but must not throw
      expect(Array.isArray(results)).toBe(true);
    });

    it('enforces workspace scoping — does not leak across workspaces', async () => {
      const strat = new BM25Strategy();
      const otherWs = randomUUID();
      const results = await strat.search({
        text: 'pgvector',
        workspaceId: otherWs,
      });
      expect(results).toEqual([]);
    });

    it('normalises scores into [0, 1]', async () => {
      const strat = new BM25Strategy();
      const results = await strat.search({
        text: 'BM25 ranking',
        workspaceId,
      });
      for (const r of results) {
        expect(r.score).toBeGreaterThanOrEqual(0);
        expect(r.score).toBeLessThanOrEqual(1);
      }
      // The top result should normalise to 1.0 (rank / maxRank)
      if (results.length > 0) expect(results[0].score).toBe(1);
    });
  });

  describe('MetadataStrategy', () => {
    it('returns recent articles for "past 7 days" query', async () => {
      const strat = new MetadataStrategy();
      const results = await strat.search({
        text: 'past 7 days',
        workspaceId,
      });
      const articleIds = new Set(results.map((r) => r.articleId));
      // The two recent articles should be in; the year-old one should not
      expect(articleIds.has(articleA_id)).toBe(true);
      expect(articleIds.has(articleB_id)).toBe(true);
      expect(articleIds.has(articleC_id)).toBe(false);
    });

    it('returns articles older than threshold for "after:" syntax', async () => {
      const strat = new MetadataStrategy();
      const recent = new Date(Date.now() - 30 * 86_400_000).toISOString().split('T')[0];
      const results = await strat.search({
        text: `after:${recent}`,
        workspaceId,
      });
      const articleIds = new Set(results.map((r) => r.articleId));
      expect(articleIds.has(articleA_id)).toBe(true);
      expect(articleIds.has(articleB_id)).toBe(true);
      expect(articleIds.has(articleC_id)).toBe(false);
    });

    it('orders results by createdAt DESC', async () => {
      const strat = new MetadataStrategy();
      const results = await strat.search({
        text: 'past 730 days',
        workspaceId,
      });
      // All three articles should appear, sorted newest-first
      const dates = results
        .map((r) => new Date(r.metadata.createdAt as string).getTime());
      for (let i = 1; i < dates.length; i++) {
        expect(dates[i - 1]).toBeGreaterThanOrEqual(dates[i]);
      }
    });
  });

  describe('CsvStrategy', () => {
    let uploadId: string;

    beforeAll(async () => {
      const [up] = await db
        .insert(csvUploads)
        .values({
          workspaceId,
          filename: 'test.csv',
          columnSchema: [
            { name: 'status', type: 'text' },
            { name: 'priority', type: 'numeric' },
            { name: 'notes', type: 'text' },
          ],
          rowCount: 3,
        })
        .returning();
      uploadId = up.id;

      await db.insert(csvRows).values([
        {
          uploadId,
          workspaceId,
          rowIndex: 0,
          metadata: { status: 'done', priority: 1, notes: 'finished migration tickets' },
          content: 'finished migration tickets',
        },
        {
          uploadId,
          workspaceId,
          rowIndex: 1,
          metadata: { status: 'open', priority: 3, notes: 'urgent customer bug report' },
          content: 'urgent customer bug report',
        },
        {
          uploadId,
          workspaceId,
          rowIndex: 2,
          metadata: { status: 'done', priority: 2, notes: 'sample row' },
          content: 'sample row',
        },
      ]);
    });

    it('matches column equality predicates with score 1.0', async () => {
      const strat = new CsvStrategy();
      const results = await strat.search({
        text: 'status = done',
        workspaceId,
      });
      expect(results.length).toBe(2);
      expect(results.every((r) => r.score === 1.0)).toBe(true);
    });

    it('matches numeric range predicates', async () => {
      const strat = new CsvStrategy();
      const results = await strat.search({
        text: 'priority > 2',
        workspaceId,
      });
      expect(results).toHaveLength(1);
      expect((results[0].metadata as Record<string, unknown>).priority).toBe(3);
    });

    it('falls through to BM25 on free-text remainder', async () => {
      const strat = new CsvStrategy();
      const results = await strat.search({
        text: 'urgent customer',
        workspaceId,
      });
      // BM25 path — score should be < 1.0 (capped at 0.9 in tier 2)
      expect(results.length).toBeGreaterThan(0);
      expect(results.every((r) => r.score <= 0.9)).toBe(true);
    });

    it('combines column predicate + free text without duplicating rows', async () => {
      const strat = new CsvStrategy();
      const results = await strat.search({
        text: 'status = done sample',
        workspaceId,
      });
      const ids = new Set(results.map((r) => r.id));
      expect(ids.size).toBe(results.length);
    });

    it('enforces workspace scoping', async () => {
      const strat = new CsvStrategy();
      const otherWs = randomUUID();
      const results = await strat.search({
        text: 'status = done',
        workspaceId: otherWs,
      });
      expect(results).toEqual([]);
    });
  });
});
