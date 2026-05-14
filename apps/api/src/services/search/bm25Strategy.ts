import { sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { buildMetadataWhere } from './metadataFilter.js';
import type { SearchQuery, SearchResult, SearchStrategy, QueryType } from '@web2x/shared';

interface ChunkRow extends Record<string, unknown> {
  id: string;
  article_id: string;
  title: string;
  content: string;
  rank: number;
}

export class BM25Strategy implements SearchStrategy {
  readonly name: QueryType = 'bm25';

  supports(queryType: QueryType): boolean {
    return queryType === 'bm25';
  }

  score(result: SearchResult): number {
    return result.score;
  }

  async search(query: SearchQuery): Promise<SearchResult[]> {
    const topK = query.topK ?? 8;
    const filters = query.filters ?? { workspaceId: query.workspaceId };
    const metaWhere = buildMetadataWhere(filters);

    // websearch_to_tsquery handles user input safely: quotes, ORs, negations.
    // Returns NULL for all-stopword input — the @@ operator then returns zero rows.
    const rows = await db.execute<ChunkRow>(sql`
      SELECT
        ac.id,
        ac.article_id,
        a.title,
        ac.content,
        ts_rank_cd(ac.search_vector, query) AS rank
      FROM article_chunks ac
      JOIN articles a ON a.id = ac.article_id,
           websearch_to_tsquery('english', ${query.text}) query
      WHERE ac.search_vector @@ query
        AND ${metaWhere}
      ORDER BY rank DESC
      LIMIT ${topK}
    `);

    if (rows.rows.length === 0) return [];

    // Normalise to [0, 1] — divide by the actual top rank so the best hit scores 1.0.
    // ts_rank_cd typically produces values well below 1, so flooring the divisor at 1
    // (as we did before) shrank every score and the top result never reached 1.0.
    const topRank = rows.rows[0].rank;
    const denominator = topRank > 0 ? topRank : 1;

    return rows.rows.map((row) => ({
      id: row.id,
      articleId: row.article_id,
      score: row.rank / denominator,
      content: row.content,
      metadata: { title: row.title },
      source: 'bm25' as QueryType,
    }));
  }
}
