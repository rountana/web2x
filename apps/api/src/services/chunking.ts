import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { articles, articleChunks } from '../db/schema.js';
import { resolveEmbeddingProvider } from './embeddingProvider.js';

const CHUNK_SIZE = 1500;
const OVERLAP = 200;

function splitIntoChunks(text: string): string[] {
  if (text.length <= CHUNK_SIZE) return [text];

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = start + CHUNK_SIZE;

    if (end < text.length) {
      // Prefer splitting at a paragraph boundary
      const paraBreak = text.lastIndexOf('\n\n', end);
      if (paraBreak > start + CHUNK_SIZE / 2) {
        end = paraBreak;
      } else {
        // Fall back to sentence boundary
        const sentBreak = text.lastIndexOf('. ', end);
        if (sentBreak > start + CHUNK_SIZE / 2) {
          end = sentBreak + 1;
        }
      }
    }

    chunks.push(text.slice(start, end).trim());
    start = end - OVERLAP;
    if (start >= text.length) break;
  }

  return chunks.filter((c) => c.length > 0);
}

export async function chunkAndEmbedArticle(articleId: string): Promise<void> {
  const [article] = await db
    .select({ markdownContent: articles.markdownContent })
    .from(articles)
    .where(eq(articles.id, articleId));

  if (!article) return;

  // Lock in one provider for the entire article. Mixing models in the same
  // corpus produces incompatible vectors, so we commit at the start and fail
  // atomically if the provider dies mid-way.
  const provider = await resolveEmbeddingProvider();

  // Remove existing chunks for idempotency
  await db.delete(articleChunks).where(eq(articleChunks.articleId, articleId));

  const chunks = splitIntoChunks(article.markdownContent);

  try {
    for (let i = 0; i < chunks.length; i++) {
      const content = chunks[i];
      const embedding = await provider.embedDocument(content);

      await db.insert(articleChunks).values({
        articleId,
        chunkIndex: i,
        content,
        embedding,
        embeddingModel: provider.modelId,
      });
    }
  } catch (err) {
    // Clean up partial chunks so the next retry starts from a clean state
    // and can pick the appropriate provider at that time.
    await db.delete(articleChunks).where(eq(articleChunks.articleId, articleId)).catch(() => {});
    throw err;
  }

  console.log(`[Chunking] Article ${articleId}: ${chunks.length} chunks embedded via ${provider.modelId}`);
}
