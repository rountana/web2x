import { createMiddleware } from 'hono/factory';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/client.js';
import { workspaces } from '../db/schema.js';
import type { WorkspaceRow } from '../db/schema.js';

export type WorkspaceEnv = { Variables: { workspace: WorkspaceRow } };

export const workspaceMiddleware = createMiddleware<WorkspaceEnv>(async (c, next) => {
  const workspaceId = c.req.header('x-workspace-id') ?? null;
  const userId = c.req.header('x-anon-id') ?? null;

  if (!workspaceId || !userId) {
    return c.json(
      { error: 'x-workspace-id and x-anon-id headers are required', code: 'MISSING_WORKSPACE' },
      400
    );
  }

  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(and(eq(workspaces.id, workspaceId), eq(workspaces.userId, userId)));

  if (!workspace) {
    return c.json({ error: 'Workspace not found', code: 'NOT_FOUND' }, 404);
  }

  c.set('workspace', workspace);
  await next();
});
