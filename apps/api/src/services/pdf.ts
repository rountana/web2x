import puppeteer from 'puppeteer';
import { promises as fs } from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { ArticleRow } from '../db/schema.js';
import type { PdfResponse } from '@web2x/shared';
import { addPdfCleanupJob } from '../workers/queue.js';

function getPdfDir(): string {
  return path.resolve(process.env.PDF_STORAGE_DIR ?? path.join(process.cwd(), 'uploads', 'pdfs'));
}

function buildHtml(article: ArticleRow): string {
  const escapedTitle = escapeHtml(article.title);
  const escapedUrl = escapeHtml(article.sourceUrl);
  const extractedDate = article.extractedAt
    ? new Date(article.extractedAt).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; max-width: 760px; margin: 24px auto; padding: 0 16px; color: #202124; line-height: 1.6; }
  h1 { font-size: 1.8em; margin-bottom: 4px; }
  .meta { color: #5f6368; font-size: 0.9em; margin-bottom: 28px; }
  h2, h3 { margin-top: 1.5em; }
  p { margin: 0 0 0.85em; }
  ul, ol { margin: 0 0 0.85em 1.2em; padding: 0; }
  pre { background: #f5f5f5; padding: 12px; border-radius: 4px; overflow-x: auto; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; background: #f5f5f5; padding: 2px 4px; border-radius: 2px; }
  blockquote { border-left: 3px solid #c4c7c5; margin: 0; padding-left: 16px; color: #3c4043; }
  a { color: #1a73e8; word-break: break-all; }
  @page { margin: 20mm; }
</style>
</head>
<body>
  <h1>${escapedTitle}</h1>
  <p class="meta">
    ${escapedUrl ? `Source: <a href="${escapedUrl}">${escapedUrl}</a><br />` : ''}
    Extracted: ${extractedDate} · ${article.wordCount} words
  </p>
  <div>${markdownToHtml(article.markdownContent)}</div>
</body>
</html>`;
}

function markdownToHtml(md: string): string {
  const safeMd = escapeHtml(md);

  return safeMd
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/^/, '<p>')
    .replace(/$/, '</p>');
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function generatePdf(article: ArticleRow): Promise<PdfResponse> {
  const pdfDir = getPdfDir();
  await fs.mkdir(pdfDir, { recursive: true });

  const filename = `${uuidv4()}.pdf`;
  const filePath = path.join(pdfDir, filename);
  const expiresInSeconds = 3600;

  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setContent(buildHtml(article), { waitUntil: 'networkidle0' });
    const pdfBuffer = await page.pdf({
      format: 'A4',
      margin: { top: '20mm', bottom: '20mm', left: '20mm', right: '20mm' },
    });
    await fs.writeFile(filePath, pdfBuffer);
  } finally {
    await browser.close();
  }

  await addPdfCleanupJob(article.id, filePath, expiresInSeconds * 1000);

  const baseUrl = process.env.API_BASE_URL ?? `http://localhost:${process.env.API_PORT ?? 3001}`;
  const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();

  return { url: `${baseUrl}/api/v1/pdfs/${filename}`, expiresAt };
}
