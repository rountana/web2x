import type { SearchQuery, SearchResult, SearchStrategy, QueryType } from '@web2x/shared';
import type { ChunkSource } from '../chatService.js';

/**
 * Group retrieved chunks by article and assemble a context block.
 * Respects the maxContextChars cap — stops adding article blocks when the
 * running total would exceed it. Returns the assembled context and the source
 * list (one entry per article that contributed at least one chunk).
 */
export function assembleRagContext(
  results: SearchResult[],
  maxContextChars: number = 6000,
): { context: string; sources: ChunkSource[] } {
  const byArticle = new Map<string, { title: string; chunks: string[] }>();
  for (const r of results) {
    if (!byArticle.has(r.articleId)) {
      byArticle.set(r.articleId, {
        title: (r.metadata.title as string) ?? 'Untitled',
        chunks: [],
      });
    }
    byArticle.get(r.articleId)!.chunks.push(r.content);
  }

  let context = '';
  const sources: ChunkSource[] = [];
  for (const [articleId, { title, chunks }] of byArticle) {
    const block = `## ${title}\n\n${chunks.join('\n\n')}`;
    if ((context + block).length > maxContextChars) break;
    context += (context ? '\n\n' : '') + block;
    sources.push({ articleId, title });
  }

  return { context, sources };
}

/**
 * RagStrategy is a composer: it wraps any SearchStrategy retriever and exposes
 * the same contract. Generation (calling buildChatStream) lives in the route
 * because it owns the SSE pipe — RagStrategy stops at retrieve + assemble.
 *
 * Swapping `retriever` changes the grounding source without changing how
 * results are assembled into context.
 */
export class RagStrategy implements SearchStrategy {
  readonly name: QueryType = 'rag';

  constructor(
    private readonly retriever: SearchStrategy,
    private readonly maxContextChars: number = 6000,
  ) {}

  supports(queryType: QueryType): boolean {
    return queryType === 'rag';
  }

  score(result: SearchResult): number {
    return result.score;
  }

  async search(query: SearchQuery): Promise<SearchResult[]> {
    return this.retriever.search(query);
  }

  /**
   * Full retrieve + assemble pass. The route calls this and then hands the
   * assembled context to buildChatStream for generation.
   */
  async retrieveAndAssemble(query: SearchQuery): Promise<{
    context: string;
    sources: ChunkSource[];
    results: SearchResult[];
  }> {
    const results = await this.retriever.search(query);
    const { context, sources } = assembleRagContext(results, this.maxContextChars);
    return { context, sources, results };
  }
}
