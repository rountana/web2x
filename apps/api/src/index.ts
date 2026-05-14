import { serve } from '@hono/node-server';
import { app } from './app.js';
import { startExtractionWorker } from './workers/extractionWorker.js';
import { startChunkingWorker } from './workers/chunkingWorker.js';

const port = Number(process.env.API_PORT ?? 3001);

startExtractionWorker();
startChunkingWorker();

serve({ fetch: app.fetch, port }, () => {
  console.log(`web2x API listening on http://localhost:${port}`);
});
