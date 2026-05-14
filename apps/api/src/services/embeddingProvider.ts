import { GoogleGenerativeAI, TaskType } from '@google/generative-ai';
import { embedText, MlxUnavailableError } from './mlxClient.js';

export interface EmbeddingProvider {
  readonly modelId: string;
  embedDocument(text: string): Promise<number[]>;
  embedQuery(text: string): Promise<number[]>;
}

class MlxEmbeddingProvider implements EmbeddingProvider {
  readonly modelId = 'mlx/nomic-embed-text-v1.5';

  embedDocument(text: string): Promise<number[]> {
    return embedText(`search_document: ${text}`);
  }

  embedQuery(text: string): Promise<number[]> {
    return embedText(`search_query: ${text}`);
  }
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

class GeminiEmbeddingProvider implements EmbeddingProvider {
  readonly modelId = 'gemini/text-embedding-004';
  private readonly model = genAI.getGenerativeModel({ model: 'text-embedding-004' });

  async embedDocument(text: string): Promise<number[]> {
    const result = await this.model.embedContent({
      content: { role: 'user', parts: [{ text }] },
      taskType: TaskType.RETRIEVAL_DOCUMENT,
    });
    return result.embedding.values;
  }

  async embedQuery(text: string): Promise<number[]> {
    const result = await this.model.embedContent({
      content: { role: 'user', parts: [{ text }] },
      taskType: TaskType.RETRIEVAL_QUERY,
    });
    return result.embedding.values;
  }
}

// Probes MLX with a minimal call. If unavailable, returns Gemini.
// Commit to a single provider per operation — never mix models on the same corpus.
export async function resolveEmbeddingProvider(): Promise<EmbeddingProvider> {
  try {
    await embedText('probe');
    return new MlxEmbeddingProvider();
  } catch (err) {
    if (err instanceof MlxUnavailableError) {
      console.warn('[EmbeddingProvider] MLX unavailable, falling back to gemini/text-embedding-004');
      return new GeminiEmbeddingProvider();
    }
    throw err;
  }
}
