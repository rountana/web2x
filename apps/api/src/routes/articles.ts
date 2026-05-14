import { Hono } from 'hono';
import { eq, desc, count, and, isNotNull } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.js';
import { articles, articleChunks } from '../db/schema.js';
import { ValidationError, NotFoundError } from '../middleware/error.js';
import { validateAndSanitizeUrl } from '../services/urlValidator.js';
import { addExtractionJob } from '../workers/queue.js';
import type { CreateArticleResponse, ArticleListItem, ArticleListResponse } from '@web2x/shared';
import type { WorkspaceEnv } from '../middleware/workspace.js';

const createSchema = z.object({ url: z.string().url() });

export const articlesRouter = new Hono<WorkspaceEnv>();

articlesRouter.post('/', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) throw new ValidationError('url is required and must be a valid URL');

  await validateAndSanitizeUrl(parsed.data.url);

  const workspace = c.get('workspace');
  const [article] = await db
    .insert(articles)
    .values({ sourceUrl: parsed.data.url, userId: workspace.userId, workspaceId: workspace.id })
    .returning({ id: articles.id, status: articles.status });

  await addExtractionJob(article.id, parsed.data.url);

  return c.json<CreateArticleResponse>({ id: article.id, status: 'pending' }, 202);
});

articlesRouter.get('/', async (c) => {
  const workspace = c.get('workspace');
  const page = Math.max(1, Number(c.req.query('page') ?? 1));
  const limit = 20;
  const offset = (page - 1) * limit;

  const where = eq(articles.workspaceId, workspace.id);

  const [{ total }] = await db.select({ total: count() }).from(articles).where(where);

  const rows = await db
    .select({
      id: articles.id,
      title: articles.title,
      sourceUrl: articles.sourceUrl,
      status: articles.status,
      wordCount: articles.wordCount,
      createdAt: articles.createdAt,
    })
    .from(articles)
    .where(where)
    .orderBy(desc(articles.createdAt))
    .limit(limit)
    .offset(offset);

  return c.json<ArticleListResponse>({ articles: rows, total, page, pageSize: limit });
});

articlesRouter.get('/:id', async (c) => {
  const workspace = c.get('workspace');
  const id = c.req.param('id');
  const [row] = await db
    .select()
    .from(articles)
    .where(and(eq(articles.id, id), eq(articles.workspaceId, workspace.id)));
  if (!row) throw new NotFoundError('Article');
  return c.json(row);
});

articlesRouter.get('/:id/chunks', async (c) => {
  const workspace = c.get('workspace');
  const id = c.req.param('id');
  const [article] = await db
    .select({ id: articles.id })
    .from(articles)
    .where(and(eq(articles.id, id), eq(articles.workspaceId, workspace.id)));
  if (!article) throw new NotFoundError('Article');

  const [{ total }] = await db
    .select({ total: count() })
    .from(articleChunks)
    .where(and(eq(articleChunks.articleId, id), isNotNull(articleChunks.embedding)));
  return c.json({ count: Number(total) });
});

articlesRouter.delete('/:id', async (c) => {
  const workspace = c.get('workspace');
  const id = c.req.param('id');
  const [row] = await db
    .delete(articles)
    .where(and(eq(articles.id, id), eq(articles.workspaceId, workspace.id)))
    .returning({ id: articles.id });
  if (!row) throw new NotFoundError('Article');
  return c.json({ success: true });
});
