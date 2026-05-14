import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { promises as fs } from 'fs';
import path from 'path';
import { db } from '../db/client.js';
import { articles } from '../db/schema.js';
import { NotFoundError } from '../middleware/error.js';
import { generatePdf } from '../services/pdf.js';
import type { PdfResponse } from '@web2x/shared';
import type { WorkspaceEnv } from '../middleware/workspace.js';

export const pdfRouter = new Hono<WorkspaceEnv>();

pdfRouter.post('/:id/pdf', async (c) => {
  const workspace = c.get('workspace');
  const articleId = c.req.param('id');
  const [article] = await db
    .select()
    .from(articles)
    .where(and(eq(articles.id, articleId), eq(articles.workspaceId, workspace.id)));
  if (!article) throw new NotFoundError('Article');
  if (article.status !== 'ready') return c.json({ error: 'Article not ready yet' }, 409);

  const result = await generatePdf(article);
  return c.json<PdfResponse>(result);
});

export const pdfDownloadRouter = new Hono();

// Serves locally-stored PDFs by UUID filename. The UUID acts as an unguessable token.
pdfDownloadRouter.get('/:filename', async (c) => {
  const filename = c.req.param('filename');
  if (!/^[\da-f-]{36}\.pdf$/i.test(filename)) {
    return c.json({ error: 'Not found' }, 404);
  }

  const pdfDir = path.resolve(process.env.PDF_STORAGE_DIR ?? path.join(process.cwd(), 'uploads', 'pdfs'));
  const filePath = path.join(pdfDir, filename);

  let buffer: Buffer;
  try {
    buffer = await fs.readFile(filePath);
  } catch {
    return c.json({ error: 'PDF not found or expired' }, 404);
  }

  return new Response(buffer as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
});
