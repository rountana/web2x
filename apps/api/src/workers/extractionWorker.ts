import { Worker } from 'bullmq';
import { eq } from 'drizzle-orm';
import { getBullMQConnection } from '../services/redis.js';
import { db } from '../db/client.js';
import { articles } from '../db/schema.js';
import { validateAndSanitizeUrl } from '../services/urlValidator.js';
import { extractArticle } from '../services/extractor.js';
import { addChunkingJob } from './queue.js';

export function startExtractionWorker() {
  const worker = new Worker(
    'extraction',
    async (job) => {
      const { articleId, url } = job.data as { articleId: string; url: string };

      try {
        await validateAndSanitizeUrl(url);
        const result = await extractArticle(url);

        await db
          .update(articles)
          .set({
            title: result.title,
            rawText: result.rawText,
            markdownContent: result.markdownContent,
            wordCount: result.wordCount,
            status: 'ready',
            extractedAt: new Date(),
            errorMessage: null,
          })
          .where(eq(articles.id, articleId));

        // Fire-and-forget: enqueue embedding job
        addChunkingJob(articleId).catch((err) =>
          console.error(`[ExtractionWorker] Failed to enqueue chunking job for ${articleId}:`, err)
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown extraction error';
        await db
          .update(articles)
          .set({ status: 'failed', errorMessage: message })
          .where(eq(articles.id, articleId));
        throw err;
      }
    },
    { connection: getBullMQConnection(), concurrency: 5 }
  );

  worker.on('failed', (job, err) => {
    console.error(`[Worker] Job ${job?.id} failed:`, err.message);
  });

  console.log('[Worker] Extraction worker started');
  return worker;
}
