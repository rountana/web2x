import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { eq, and, gte, lte, desc, ne } from 'drizzle-orm';
import { db } from '../db/client.js';
import { articles, summaries } from '../db/schema.js';
import { buildChatStream } from '../services/chatService.js';
import { buildWorkspaceArticleIndex } from '../services/workspaceContext.js';
import { parseQueryIntent } from '../services/queryUnderstanding.js';
import { resolveStrategy } from '../services/search/registry.js';
import { assembleRagContext } from '../services/search/ragStrategy.js';
import { ValidationError } from '../middleware/error.js';
import type { WorkspaceEnv } from '../middleware/workspace.js';
import type { QueryType } from '@web2x/shared';

export const chatRouter = new Hono<WorkspaceEnv>();

const MAX_CONTEXT_CHARS = 6000;
const TOP_K = 8;

const chatSchema = z.object({
  query: z.string().min(1).max(2000),
  articleId: z.string().uuid().optional(),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().max(4000),
      })
    )
    .max(20)
    .optional()
    .default([]),
});

chatRouter.post('/', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = chatSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError('query is required (max 2000 chars)');
  }

  const { query, articleId, history } = parsed.data;
  const workspace = c.get('workspace');
  const workspaceId = workspace.id;

  // When scoped to a single article, skip query understanding and workspace index.
  const [intent, workspaceIndex] = await Promise.all([
    articleId
      ? Promise.resolve({ retrieval_mode: 'semantic_search' as const, filters: {}, reformulated_query: query, context_hint: '' })
      : parseQueryIntent(query),
    articleId ? Promise.resolve('') : buildWorkspaceArticleIndex(workspaceId),
  ]);

  const { retrieval_mode, filters, reformulated_query, context_hint } = intent;
  const searchQuery = reformulated_query || query;

  let context = '';
  const sources: { articleId: string; title: string }[] = [];

  // ── list_then_summarize: enumerate all articles in the date window ──────────
  if (retrieval_mode === 'list_then_summarize') {
    const conditions = [
      eq(articles.workspaceId, workspaceId),
      eq(articles.status, 'ready'),
    ];
    if (filters.dateFrom) conditions.push(gte(articles.createdAt, new Date(filters.dateFrom)));
    if (filters.dateTo)   conditions.push(lte(articles.createdAt, new Date(filters.dateTo)));

    const rows = await db
      .select({
        id:              articles.id,
        title:           articles.title,
        markdownContent: articles.markdownContent,
        createdAt:       articles.createdAt,
        overview:        summaries.overview,
        keyPoints:       summaries.keyPoints,
      })
      .from(articles)
      .leftJoin(summaries, eq(summaries.articleId, articles.id))
      .where(and(...conditions))
      .orderBy(desc(articles.createdAt))
      .limit(20);

    for (const row of rows) {
      const dateStr = row.createdAt?.toISOString().split('T')[0] ?? '';
      let block = `## ${row.title} (Added: ${dateStr})\n\n`;

      if (row.overview) {
        block += `**Overview:** ${row.overview}\n\n`;
        if (row.keyPoints && (row.keyPoints as string[]).length > 0) {
          block += `**Key points:**\n${(row.keyPoints as string[]).map((p) => `- ${p}`).join('\n')}\n`;
        }
      } else {
        block += row.markdownContent.slice(0, 1200);
        if (row.markdownContent.length > 1200) block += '\n…';
      }

      if ((context + block).length > MAX_CONTEXT_CHARS) break;
      context += (context ? '\n\n' : '') + block;
      sources.push({ articleId: row.id, title: row.title });
    }

  // ── all other modes: dispatch through strategy registry, assemble via RAG ──
  } else {
    const strategy =
      resolveStrategy(retrieval_mode as QueryType) ?? resolveStrategy('vector')!;

    const results = await strategy.search({
      text:        searchQuery,
      workspaceId,
      articleId,
      filters:     { workspaceId, ...filters },
      topK:        TOP_K,
    });

    const assembled = assembleRagContext(results, MAX_CONTEXT_CHARS);
    context = assembled.context;
    sources.push(...assembled.sources);

    // Fallback: no chunks retrieved (MLX down at index time, or race with chunking worker).
    // Article-scoped → read that article's raw markdown.
    // Workspace-level → read the 3 most recent articles' raw markdown.
    if (results.length === 0) {
      console.warn(`[Chat] No indexed chunks found — falling back to raw article text (articleId=${articleId ?? 'workspace:' + workspaceId})`);
      if (articleId) {
        const [art] = await db
          .select({ markdownContent: articles.markdownContent, title: articles.title })
          .from(articles)
          .where(eq(articles.id, articleId));
        if (art?.markdownContent) {
          context = art.markdownContent.slice(0, MAX_CONTEXT_CHARS);
          sources.push({ articleId, title: art.title });
        }
      } else {
        const rows = await db
          .select({ id: articles.id, title: articles.title, markdownContent: articles.markdownContent })
          .from(articles)
          .where(and(eq(articles.workspaceId, workspaceId), ne(articles.markdownContent, '')))
          .orderBy(desc(articles.createdAt))
          .limit(3);
        for (const row of rows) {
          const remaining = MAX_CONTEXT_CHARS - context.length;
          if (remaining <= 0) break;
          const block = `## ${row.title}\n\n${row.markdownContent}`;
          context += (context ? '\n\n' : '') + block.slice(0, remaining);
          sources.push({ articleId: row.id, title: row.title });
        }
      }
    }
  }

  return streamSSE(c, async (stream) => {
    for await (const event of buildChatStream(query, context, history, sources, context_hint || undefined, workspaceIndex || undefined)) {
      if (event.type === 'token') {
        await stream.writeSSE({ data: event.text, event: 'token' });
      } else if (event.type === 'sources') {
        await stream.writeSSE({ data: JSON.stringify(event.sources), event: 'sources' });
      } else {
        await stream.writeSSE({ data: event.message, event: 'error' });
      }
    }
  });
});
