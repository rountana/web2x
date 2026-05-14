import { Worker } from 'bullmq';
import { promises as fs } from 'fs';
import { getBullMQConnection } from '../services/redis.js';

type PdfCleanupJobData = {
  articleId: string;
  filePath: string;
};

export function startPdfCleanupWorker() {
  const worker = new Worker(
    'pdf_cleanup',
    async (job) => {
      const { articleId, filePath } = job.data as PdfCleanupJobData;
      try {
        await fs.unlink(filePath);
        console.log(`[Worker] Deleted expired PDF for article ${articleId}: ${filePath}`);
      } catch (err: any) {
        if (err.code !== 'ENOENT') throw err;
      }
    },
    { connection: getBullMQConnection(), concurrency: 3 }
  );

  worker.on('failed', (job, err) => {
    console.error(`[Worker] PDF cleanup job ${job?.id} failed:`, err.message);
  });

  console.log('[Worker] PDF cleanup worker started');
  return worker;
}
