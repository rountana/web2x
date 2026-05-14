import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/client.js';
import { articles } from '../db/schema.js';
import { ValidationError } from '../middleware/error.js';
import { parsePdf } from '../services/pdfParser.js';
import { addChunkingJob } from '../workers/queue.js';
import type { CreateArticleResponse } from '@web2x/shared';
import type { WorkspaceEnv } from '../middleware/workspace.js';

export const ingestRouter = new Hono<WorkspaceEnv>();

const MAX_CONTENT_CHARS = 500_000;
const MAX_PDF_BYTES = 10 * 1024 * 1024; // 10 MB

const markdownSchema = z.object({
  content: z.string().min(1).max(MAX_CONTENT_CHARS),
  title: z.string().max(500).optional(),
});

function extractTitleFromMarkdown(content: string): string {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : 'Untitled';
}

function markdownToRawText(md: string): string {
  return md.replace(/[#*`\[\]()_~>]/g, ' ').replace(/\s+/g, ' ').trim();
}

ingestRouter.post('/ingest/markdown', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = markdownSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError('content is required (max 500,000 chars); title is optional');
  }

  const { content, title } = parsed.data;
  const resolvedTitle = title?.trim() || extractTitleFromMarkdown(content);
  const rawText = markdownToRawText(content);
  const wordCount = rawText.split(/\s+/).filter(Boolean).length;

  const workspace = c.get('workspace');

  const [article] = await db
    .insert(articles)
    .values({
      sourceUrl: '',
      userId: workspace.userId,
      workspaceId: workspace.id,
      title: resolvedTitle,
      rawText,
      markdownContent: content,
      wordCount,
      status: 'ready',
      extractedAt: new Date(),
    })
    .returning({ id: articles.id, status: articles.status });

  addChunkingJob(article.id).catch((err) =>
    console.error(`[Ingest] Failed to enqueue chunking for ${article.id}:`, err)
  );

  return c.json<CreateArticleResponse>({ id: article.id, status: 'pending' }, 201);
});

ingestRouter.post('/ingest/pdf', async (c) => {
  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch {
    throw new ValidationError('Expected multipart/form-data with a pdf file field');
  }

  const file = formData.get('file');
  if (!(file instanceof File)) {
    throw new ValidationError('file field is required');
  }
  if (file.type !== 'application/pdf') {
    throw new ValidationError('file must be a PDF (application/pdf)');
  }
  if (file.size > MAX_PDF_BYTES) {
    throw new ValidationError('PDF must be smaller than 10 MB');
  }

  const rawTitle = (formData.get('title') as string | null)?.trim();
  const titleFromFilename = file.name.replace(/\.pdf$/i, '').trim() || 'Untitled';

  const buffer = Buffer.from(await file.arrayBuffer());

  let parsed: Awaited<ReturnType<typeof parsePdf>>;
  try {
    parsed = await parsePdf(buffer);
  } catch {
    throw new ValidationError('Could not parse PDF — file may be encrypted or corrupt');
  }

  const resolvedTitle = rawTitle || titleFromFilename;
  const workspace = c.get('workspace');

  const [article] = await db
    .insert(articles)
    .values({
      sourceUrl: '',
      userId: workspace.userId,
      workspaceId: workspace.id,
      title: resolvedTitle,
      rawText: parsed.rawText,
      markdownContent: parsed.markdownContent,
      wordCount: parsed.wordCount,
      status: 'ready',
      extractedAt: new Date(),
    })
    .returning({ id: articles.id, status: articles.status });

  addChunkingJob(article.id).catch((err) =>
    console.error(`[Ingest] Failed to enqueue chunking for ${article.id}:`, err)
  );

  return c.json<CreateArticleResponse>({ id: article.id, status: 'pending' }, 201);
});
