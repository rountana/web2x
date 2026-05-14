import { Hono } from 'hono';
import { z } from 'zod';
import { resolveStrategy } from '../services/search/registry.js';
import { ValidationError } from '../middleware/error.js';
import type { WorkspaceEnv } from '../middleware/workspace.js';

export const searchRouter = new Hono<WorkspaceEnv>();

const searchSchema = z.object({
  query: z.string().min(1).max(2000),
  algorithm: z.enum(['bm25', 'vector', 'hybrid', 'rag', 'csv', 'metadata']),
  topK: z.number().int().min(1).max(50).optional().default(8),
});

searchRouter.post('/', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = searchSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError('query (string) and algorithm ("bm25" | "vector" | "hybrid" | "rag" | "csv" | "metadata") are required');
  }

  const { query, algorithm, topK } = parsed.data;
  const workspace = c.get('workspace');

  const strategy = resolveStrategy(algorithm);
  if (!strategy) {
    throw new ValidationError(`Algorithm "${algorithm}" is not available`);
  }

  const results = await strategy.search({
    text: query,
    workspaceId: workspace.id,
    topK,
  });

  return c.json({ results });
});
