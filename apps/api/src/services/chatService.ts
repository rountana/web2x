import { GoogleGenerativeAI } from '@google/generative-ai';
import { streamChat, MlxUnavailableError, type ChatHistoryItem } from './mlxClient.js';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.0-flash-lite';

export interface ChunkSource {
  articleId: string;
  title: string;
}

export async function* buildChatStream(
  query: string,
  context: string,
  history: ChatHistoryItem[],
  sources: ChunkSource[],
  systemExtra?: string,
  workspaceIndex?: string
): AsyncGenerator<
  | { type: 'token'; text: string }
  | { type: 'sources'; sources: ChunkSource[] }
  | { type: 'error'; message: string }
> {
  const indexBlock = workspaceIndex ? `<workspace_index>\n${workspaceIndex}\n</workspace_index>` : '';
  const combinedContext = [indexBlock, context].filter(Boolean).join('\n\n');

  try {
    let mlxTokenCount = 0;
    for await (const token of streamChat(query, combinedContext, history)) {
      mlxTokenCount += 1;
      yield { type: 'token', text: token };
    }

    if (mlxTokenCount === 0) {
      throw new MlxUnavailableError(new Error('MLX returned an empty completion'));
    }
  } catch (err) {
    if (!(err instanceof MlxUnavailableError)) throw err;

    console.warn('[ChatService] MLX unavailable, falling back to Gemini:', err);

    try {
      const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });
      const systemInstruction =
        'You are a helpful assistant that answers questions based on the provided context. ' +
        'Cite which document your answer comes from when relevant. ' +
        'If the context does not contain enough information, say so honestly.' +
        (systemExtra ? ` ${systemExtra}` : '');

      const contextBlock = combinedContext ? `<context>\n${combinedContext}\n</context>\n\n` : '';
      const userContent = `${contextBlock}${query}`;

      const geminiHistory = history.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

      const chat = model.startChat({ history: geminiHistory, systemInstruction });
      const result = await chat.sendMessageStream(userContent);
      let geminiTokenCount = 0;
      for await (const chunk of result.stream) {
        const text = chunk.text();
        if (text) {
          geminiTokenCount += 1;
          yield { type: 'token', text };
        }
      }

      if (geminiTokenCount === 0) {
        throw new Error('Gemini returned an empty completion');
      }
    } catch (geminiErr) {
      console.error('[ChatService] Gemini fallback failed:', geminiErr);
      yield { type: 'error', message: 'All AI providers are currently unavailable. Please try again later.' };
      return;
    }
  }

  yield { type: 'sources', sources };
}
