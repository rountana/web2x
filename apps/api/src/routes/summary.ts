import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/client.js';
import { articles, summaries } from '../db/schema.js';
import { NotFoundError } from '../middleware/error.js';
import { generateSummary } from '../services/llm.js';
import type { WorkspaceEnv } from '../middleware/workspace.js';

export const summaryRouter = new Hono<WorkspaceEnv>();

summaryRouter.post('/:id/summary', async (c) => {
  const workspace = c.get('workspace');
  const articleId = c.req.param('id');
  const [article] = await db
    .select()
    .from(articles)
    .where(and(eq(articles.id, articleId), eq(articles.workspaceId, workspace.id)));
  if (!article) throw new NotFoundError('Article');
  if (article.status !== 'ready') return c.json({ error: 'Article not ready yet' }, 409);

  const existing = await db.select().from(summaries).where(eq(summaries.articleId, articleId));
  if (existing[0]) return c.json(existing[0]);

  const { keyPoints, overview } = await generateSummary(article.rawText);
  const [summary] = await db.insert(summaries).values({ articleId, keyPoints, overview }).returning();
  return c.json(summary);
});

summaryRouter.get('/:id/summary', async (c) => {
  const workspace = c.get('workspace');
  const articleId = c.req.param('id');
  const [article] = await db
    .select({ id: articles.id })
    .from(articles)
    .where(and(eq(articles.id, articleId), eq(articles.workspaceId, workspace.id)));
  if (!article) throw new NotFoundError('Article');

  const [summary] = await db.select().from(summaries).where(eq(summaries.articleId, articleId));
  if (!summary) throw new NotFoundError('Summary');
  return c.json(summary);
});
