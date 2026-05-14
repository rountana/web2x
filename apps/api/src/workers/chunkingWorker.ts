import { Worker } from 'bullmq';
import { eq } from 'drizzle-orm';
import { getBullMQConnection } from '../services/redis.js';
import { chunkAndEmbedArticle } from '../services/chunking.js';
import { db } from '../db/client.js';
import { articles } from '../db/schema.js';

export function startChunkingWorker() {
  const worker = new Worker(
    'chunking',
    async (job) => {
      const { articleId } = job.data as { articleId: string };
      await chunkAndEmbedArticle(articleId);
    },
    { connection: getBullMQConnection(), concurrency: 2 }
  );

  worker.on('failed', async (job, err) => {
    console.error(`[ChunkingWorker] Job ${job?.id} failed:`, err.message);

    if (!job) return;
    const isFinalAttempt = job.attemptsMade >= (job.opts.attempts ?? 1);
    if (isFinalAttempt) {
      const { articleId } = job.data as { articleId: string };
      await db
        .update(articles)
        .set({ status: 'failed', errorMessage: `Indexing failed: ${err.message}` })
        .where(eq(articles.id, articleId))
        .catch((dbErr) =>
          console.error(`[ChunkingWorker] Failed to mark article ${articleId} as failed:`, dbErr)
        );
    }
  });

  console.log('[ChunkingWorker] Chunking worker started');
  return worker;
}
