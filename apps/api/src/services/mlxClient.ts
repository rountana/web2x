const MLX_URL = process.env.MLX_SERVICE_URL ?? 'http://localhost:8001';
const TIMEOUT_MS = 5_000;
const STREAM_IDLE_TIMEOUT_MS = 30_000;

export class MlxUnavailableError extends Error {
  constructor(cause?: unknown) {
    super('MLX service unavailable');
    this.name = 'MlxUnavailableError';
    if (cause instanceof Error) this.cause = cause;
  }
}

export interface ChatHistoryItem {
  role: 'user' | 'assistant';
  content: string;
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('ECONNREFUSED') || msg.includes('fetch failed') || msg.includes('abort')) {
      throw new MlxUnavailableError(err);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function embedText(text: string): Promise<number[]> {
  let res: Response;
  try {
    res = await fetchWithTimeout(`${MLX_URL}/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
  } catch (err) {
    if (err instanceof MlxUnavailableError) throw err;
    throw new MlxUnavailableError(err);
  }

  if (!res.ok) {
    throw new MlxUnavailableError(new Error(`MLX /embed returned ${res.status}`));
  }
  const data = (await res.json()) as { embedding: number[] };
  return data.embedding;
}

export async function* streamChat(
  query: string,
  context: string,
  history: ChatHistoryItem[]
): AsyncGenerator<string> {
  let res: Response;
  try {
    res = await fetchWithTimeout(`${MLX_URL}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, context, history }),
    });
  } catch (err) {
    if (err instanceof MlxUnavailableError) throw err;
    throw new MlxUnavailableError(err);
  }

  if (!res.ok) throw new MlxUnavailableError(new Error(`MLX /chat returned ${res.status}`));
  if (!res.body) throw new Error('MLX /chat returned no body');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  async function readWithIdleTimeout() {
    return Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new MlxUnavailableError(new Error('MLX stream idle timeout'))),
          STREAM_IDLE_TIMEOUT_MS
        );
      }),
    ]);
  }

  while (true) {
    const { done, value } = await readWithIdleTimeout();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') return;
        try {
          // MLX service JSON-encodes each token to handle newlines/special chars
          yield JSON.parse(payload) as string;
        } catch {
          // malformed token — skip
        }
      }
    }
  }
}
