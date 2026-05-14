import { Hono } from 'hono';
import { eq, and, count } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.js';
import { workspaces } from '../db/schema.js';
import { ValidationError, NotFoundError } from '../middleware/error.js';
import type { WorkspaceListResponse, CreateWorkspaceResponse, Workspace } from '@web2x/shared';

const nameSchema = z.string().min(1).max(100).trim();

export const workspacesRouter = new Hono();

workspacesRouter.post('/', async (c) => {
  const userId = c.req.header('x-anon-id');
  if (!userId) throw new ValidationError('x-anon-id header is required');

  const body = await c.req.json().catch(() => null);
  const parsed = nameSchema.safeParse(body?.name);
  if (!parsed.success) throw new ValidationError('name is required (max 100 chars)');

  const [ws] = await db
    .insert(workspaces)
    .values({ userId, name: parsed.data })
    .returning({ id: workspaces.id, name: workspaces.name });

  return c.json<CreateWorkspaceResponse>(ws, 201);
});

workspacesRouter.get('/', async (c) => {
  const userId = c.req.header('x-anon-id');
  if (!userId) throw new ValidationError('x-anon-id header is required');

  const rows = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.userId, userId))
    .orderBy(workspaces.createdAt);

  const result: Workspace[] = rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    name: r.name,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));

  return c.json<WorkspaceListResponse>({ workspaces: result });
});

workspacesRouter.get('/:id', async (c) => {
  const userId = c.req.header('x-anon-id');
  if (!userId) throw new ValidationError('x-anon-id header is required');

  const [ws] = await db
    .select()
    .from(workspaces)
    .where(and(eq(workspaces.id, c.req.param('id')), eq(workspaces.userId, userId)));

  if (!ws) throw new NotFoundError('Workspace');

  return c.json<Workspace>({
    id: ws.id,
    userId: ws.userId,
    name: ws.name,
    createdAt: ws.createdAt.toISOString(),
    updatedAt: ws.updatedAt.toISOString(),
  });
});

workspacesRouter.patch('/:id', async (c) => {
  const userId = c.req.header('x-anon-id');
  if (!userId) throw new ValidationError('x-anon-id header is required');

  const body = await c.req.json().catch(() => null);
  const parsed = nameSchema.safeParse(body?.name);
  if (!parsed.success) throw new ValidationError('name is required (max 100 chars)');

  const [ws] = await db
    .update(workspaces)
    .set({ name: parsed.data, updatedAt: new Date() })
    .where(and(eq(workspaces.id, c.req.param('id')), eq(workspaces.userId, userId)))
    .returning();

  if (!ws) throw new NotFoundError('Workspace');

  return c.json<Workspace>({
    id: ws.id,
    userId: ws.userId,
    name: ws.name,
    createdAt: ws.createdAt.toISOString(),
    updatedAt: ws.updatedAt.toISOString(),
  });
});

workspacesRouter.delete('/:id', async (c) => {
  const userId = c.req.header('x-anon-id');
  if (!userId) throw new ValidationError('x-anon-id header is required');

  const [{ remaining }] = await db
    .select({ remaining: count() })
    .from(workspaces)
    .where(eq(workspaces.userId, userId));

  if (Number(remaining) <= 1) {
    return c.json({ error: 'Cannot delete the last workspace', code: 'LAST_WORKSPACE' }, 400);
  }

  const [deleted] = await db
    .delete(workspaces)
    .where(and(eq(workspaces.id, c.req.param('id')), eq(workspaces.userId, userId)))
    .returning({ id: workspaces.id });

  if (!deleted) throw new NotFoundError('Workspace');

  return c.json({ success: true });
});
