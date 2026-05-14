import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { ingestRouter } from './routes/ingest.js';
import { articlesRouter } from './routes/articles.js';
import { deckRouter } from './routes/deck.js';
import { quizRouter } from './routes/quiz.js';
import { summaryRouter } from './routes/summary.js';
import { pdfRouter, pdfDownloadRouter } from './routes/pdf.js';
import { mdRouter } from './routes/md.js';
import { shareTargetRouter } from './routes/shareTarget.js';
import { chatRouter } from './routes/chat.js';
import { searchRouter } from './routes/search.js';
import { csvRouter } from './routes/csv.js';
import { workspacesRouter } from './routes/workspaces.js';
import { errorMiddleware } from './middleware/error.js';
import { rateLimitMiddleware } from './middleware/rateLimit.js';
import { workspaceMiddleware, type WorkspaceEnv } from './middleware/workspace.js';

export const app = new Hono();

app.use('*', logger());
app.use('*', secureHeaders());
app.use(
  '*',
  cors({
    origin: (process.env.CORS_ORIGIN ?? 'http://localhost:5173').split(',').map(o => o.trim()),
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'x-anon-id', 'x-workspace-id'],
    credentials: false,
  })
);

app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

const api = new Hono();
api.use('*', rateLimitMiddleware);

// Workspace-scoped routes — all require valid x-workspace-id + x-anon-id headers
const workspaceScoped = new Hono<WorkspaceEnv>();
workspaceScoped.use('*', workspaceMiddleware);
workspaceScoped.route('/articles', ingestRouter);
workspaceScoped.route('/articles', articlesRouter);
workspaceScoped.route('/articles', deckRouter);
workspaceScoped.route('/articles', quizRouter);
workspaceScoped.route('/articles', summaryRouter);
workspaceScoped.route('/articles', pdfRouter);
workspaceScoped.route('/chat', chatRouter);
workspaceScoped.route('/search', searchRouter);
workspaceScoped.route('/csv', csvRouter);

// Register specific routes BEFORE the workspace-scoped catch-all
api.route('/workspaces', workspacesRouter);
api.route('/share-target', shareTargetRouter);
api.route('/articles', mdRouter);
api.route('/pdfs', pdfDownloadRouter);
api.route('/', workspaceScoped);

app.route('/api/v1', api);

app.onError(errorMiddleware);

export default app;
