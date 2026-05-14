import { Queue } from 'bullmq';
import { getBullMQConnection } from '../services/redis.js';

const EXTRACTION_QUEUE_NAME = 'extraction';
const PDF_CLEANUP_QUEUE_NAME = 'pdf_cleanup';
const CHUNKING_QUEUE_NAME = 'chunking';

let _extractionQueue: Queue | null = null;
let _pdfCleanupQueue: Queue | null = null;
let _chunkingQueue: Queue | null = null;

function getExtractionQueue(): Queue {
  if (!_extractionQueue) {
    _extractionQueue = new Queue(EXTRACTION_QUEUE_NAME, {
      connection: getBullMQConnection(),
    });
  }
  return _extractionQueue;
}

function getPdfCleanupQueue(): Queue {
  if (!_pdfCleanupQueue) {
    _pdfCleanupQueue = new Queue(PDF_CLEANUP_QUEUE_NAME, {
      connection: getBullMQConnection(),
    });
  }
  return _pdfCleanupQueue;
}

function getChunkingQueue(): Queue {
  if (!_chunkingQueue) {
    _chunkingQueue = new Queue(CHUNKING_QUEUE_NAME, {
      connection: getBullMQConnection(),
    });
  }
  return _chunkingQueue;
}

export async function addChunkingJob(articleId: string): Promise<void> {
  await getChunkingQueue().add(
    'chunk',
    { articleId },
    {
      attempts: 3,
      backoff: { type: 'exponential', delay: 3000 },
      removeOnComplete: true,
    }
  );
}

export async function addExtractionJob(articleId: string, url: string): Promise<void> {
  await getExtractionQueue().add(
    'extract',
    { articleId, url },
    {
      attempts: 2,
      backoff: { type: 'exponential', delay: 2000 },
    }
  );
}

export async function addPdfCleanupJob(
  articleId: string,
  filePath: string,
  delayMs: number
): Promise<void> {
  await getPdfCleanupQueue().add(
    'delete_pdf',
    { articleId, filePath },
    {
      delay: delayMs,
      attempts: 2,
      removeOnComplete: true,
      backoff: { type: 'exponential', delay: 2000 },
    }
  );
}
