import { eq, and, desc } from 'drizzle-orm';
import { db } from '../db/client.js';
import { articles, summaries } from '../db/schema.js';

const MAX_ARTICLES = 1000;

export async function buildWorkspaceArticleIndex(workspaceId: string): Promise<string> {
  const rows = await db
    .select({
      title:     articles.title,
      wordCount: articles.wordCount,
      createdAt: articles.createdAt,
      overview:  summaries.overview,
    })
    .from(articles)
    .leftJoin(summaries, eq(summaries.articleId, articles.id))
    .where(and(eq(articles.workspaceId, workspaceId), eq(articles.status, 'ready')))
    .orderBy(desc(articles.createdAt))
    .limit(MAX_ARTICLES);

  if (rows.length === 0) return '';

  return rows
    .map((row) => {
      const date = row.createdAt?.toISOString().split('T')[0] ?? '';
      const overview = row.overview ? ` — ${row.overview.slice(0, 150)}` : '';
      return `[${date}] ${row.title} (${row.wordCount} words)${overview}`;
    })
    .join('\n');
}
