/**
 * One-shot backfill: enqueues chunking jobs for all ready articles that have no chunks yet.
 * Run with: pnpm --filter @web2x/api chunk:backfill
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { articles } from '../db/schema.js';
import { addChunkingJob } from '../workers/queue.js';

async function main() {
  const toBackfill = await db
    .select({ id: articles.id, title: articles.title })
    .from(articles)
    .where(
      sql`${articles.status} = 'ready'
          AND ${articles.id} NOT IN (
            SELECT DISTINCT article_id FROM article_chunks
          )`
    );

  if (toBackfill.length === 0) {
    console.log('[Backfill] All ready articles already have chunks.');
    process.exit(0);
  }

  console.log(`[Backfill] Enqueuing chunking jobs for ${toBackfill.length} articles...`);

  for (const article of toBackfill) {
    await addChunkingJob(article.id);
    console.log(`  → queued: ${article.title} (${article.id})`);
  }

  console.log('[Backfill] Done. The chunking worker will process these in the background.');
  process.exit(0);
}

main().catch((err) => {
  console.error('[Backfill] Error:', err);
  process.exit(1);
});
