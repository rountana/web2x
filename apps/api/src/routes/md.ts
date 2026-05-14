import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/client.js';
import { articles, workspaces } from '../db/schema.js';
import { NotFoundError } from '../middleware/error.js';

export const mdRouter = new Hono();

mdRouter.get('/:id/md', async (c) => {
  const workspaceId = c.req.query('workspaceId');
  const userId = c.req.query('anonId');

  if (!workspaceId || !userId) {
    return c.json(
      { error: 'workspaceId and anonId query parameters are required', code: 'MISSING_WORKSPACE' },
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

  const articleId = c.req.param('id');
  const [article] = await db
    .select()
    .from(articles)
    .where(and(eq(articles.id, articleId), eq(articles.workspaceId, workspace.id)));
  if (!article) throw new NotFoundError('Article');
  if (article.status !== 'ready') return c.json({ error: 'Article not ready yet' }, 409);

  const extractedDate = (article.extractedAt ?? new Date()).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const mdContent = [
    `# ${article.title}`,
    '',
    '## Metadata',
    '',
    ...(article.sourceUrl ? [`- **Source:** ${article.sourceUrl}`] : []),
    `- **Words:** ${article.wordCount.toLocaleString()}`,
    `- **Extracted:** ${extractedDate}`,
    '',
    '---',
    '',
    '## Content',
    '',
    article.markdownContent,
  ].join('\n');

  const jsonContent = JSON.stringify(mdContent);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(article.title)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 16px;
      line-height: 1.7;
      color: #1a1a1a;
      background: #fff;
      margin: 0;
      padding: 2rem 1rem 4rem;
    }
    #content {
      max-width: 680px;
      margin: 0 auto;
    }
    h1 { font-size: 1.9rem; font-weight: 700; margin: 0 0 0.5rem; line-height: 1.25; }
    h2 { font-size: 1.1rem; font-weight: 600; margin: 2rem 0 0.75rem; color: #444; text-transform: uppercase; letter-spacing: 0.05em; }
    h3 { font-size: 1rem; font-weight: 600; margin: 1.5rem 0 0.5rem; }
    p  { margin: 0 0 1rem; }
    ul, ol { margin: 0 0 1rem; padding-left: 1.5rem; }
    li { margin-bottom: 0.25rem; }
    a  { color: #0066cc; }
    blockquote {
      margin: 0 0 1rem;
      padding: 0.75rem 1rem;
      border-left: 3px solid #ddd;
      color: #555;
    }
    pre {
      background: #f5f5f5;
      padding: 1rem;
      overflow-x: auto;
      border-radius: 4px;
      font-size: 0.875rem;
    }
    code { font-size: 0.875em; background: #f0f0f0; padding: 0.1em 0.3em; border-radius: 3px; }
    pre code { background: none; padding: 0; }
    hr { border: none; border-top: 1px solid #e0e0e0; margin: 2rem 0; }
    table { border-collapse: collapse; width: 100%; margin-bottom: 1rem; }
    th, td { border: 1px solid #ddd; padding: 0.5rem 0.75rem; text-align: left; }
    th { background: #f5f5f5; font-weight: 600; }
  </style>
</head>
<body>
  <div id="content"><p>Loading…</p></div>
  <script src="https://cdn.jsdelivr.net/npm/marked@9/marked.min.js"></script>
  <script>
    const md = ${jsonContent};
    document.getElementById('content').innerHTML = marked.parse(md);
  </script>
</body>
</html>`;

  return c.html(html);
});

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
