import { sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { resolveEmbeddingProvider } from '../embeddingProvider.js';
import { buildMetadataWhere } from './metadataFilter.js';
import type { SearchQuery, SearchResult, SearchStrategy, QueryType } from '@web2x/shared';

interface ChunkRow extends Record<string, unknown> {
  id: string;
  article_id: string;
  title: string;
  content: string;
  distance: number;
}

export class VectorStrategy implements SearchStrategy {
  readonly name: QueryType = 'vector';

  supports(queryType: QueryType): boolean {
    return queryType === 'vector' || queryType === 'semantic_search';
  }

  score(result: SearchResult): number {
    return result.score;
  }

  async search(query: SearchQuery): Promise<SearchResult[]> {
    const topK = query.topK ?? 8;
    const filters = query.filters ?? { workspaceId: query.workspaceId };

    let embedding: number[];
    let modelId: string;
    try {
      const provider = await resolveEmbeddingProvider();
      modelId = provider.modelId;
      embedding = await provider.embedQuery(query.text);
    } catch {
      return [];
    }

    if (embedding.length === 0) return [];

    const vectorLiteral = `[${embedding.join(',')}]`;
    const metaWhere = buildMetadataWhere(filters);
    const articleFilter = query.articleId
      ? sql`AND ac.article_id = ${query.articleId}::uuid`
      : sql``;

    const rows = await db.execute<ChunkRow>(sql`
      SELECT
        ac.id,
        ac.content,
        ac.article_id,
        a.title,
        ac.embedding <=> ${vectorLiteral}::vector AS distance
      FROM article_chunks ac
      JOIN articles a ON a.id = ac.article_id
      WHERE ac.embedding IS NOT NULL
        AND ac.embedding_model = ${modelId}
        AND ${metaWhere}
        ${articleFilter}
      ORDER BY distance ASC
      LIMIT ${topK}
    `);

    return rows.rows.map((row) => ({
      id: row.id,
      articleId: row.article_id,
      score: Math.max(0, 1 - row.distance),
      content: row.content,
      metadata: { title: row.title },
      source: 'vector' as QueryType,
    }));
  }
}
