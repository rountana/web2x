import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.js';
import { articles, decks } from '../db/schema.js';
import { NotFoundError } from '../middleware/error.js';
import { generateDeck } from '../services/llm.js';
import type { WorkspaceEnv } from '../middleware/workspace.js';

const createSchema = z.object({ count: z.number().int().min(5).max(20).default(10) });

export const deckRouter = new Hono<WorkspaceEnv>();

deckRouter.post('/:id/deck', async (c) => {
  const workspace = c.get('workspace');
  const articleId = c.req.param('id');
  const [article] = await db
    .select()
    .from(articles)
    .where(and(eq(articles.id, articleId), eq(articles.workspaceId, workspace.id)));
  if (!article) throw new NotFoundError('Article');
  if (article.status !== 'ready') return c.json({ error: 'Article not ready yet' }, 409);

  const existing = await db.select().from(decks).where(eq(decks.articleId, articleId));
  if (existing[0]) return c.json(existing[0]);

  const body = await c.req.json().catch(() => ({}));
  const { count } = createSchema.parse(body);

  const cards = await generateDeck(article.rawText, count);
  const [deck] = await db.insert(decks).values({ articleId, cards }).returning();
  return c.json(deck);
});

deckRouter.get('/:id/deck', async (c) => {
  const workspace = c.get('workspace');
  const articleId = c.req.param('id');
  const [article] = await db
    .select({ id: articles.id })
    .from(articles)
    .where(and(eq(articles.id, articleId), eq(articles.workspaceId, workspace.id)));
  if (!article) throw new NotFoundError('Article');

  const [deck] = await db.select().from(decks).where(eq(decks.articleId, articleId));
  if (!deck) throw new NotFoundError('Deck');
  return c.json(deck);
});
