# Services & Workers

## Services (`apps/api/src/services/`)

---

### `extractor.ts` — Article extraction

**`extractArticle(url: string): Promise<ExtractResult>`**

1. Fetches URL with 15s timeout, user-agent: `Mozilla/5.0 (compatible; web2x/1.0)`
2. Parses HTML with JSDOM
3. Extracts main content via Mozilla Readability
4. Converts extracted HTML → Markdown via Turndown
5. Strips Markdown syntax to produce `rawText`
6. Counts words

Returns: `{ title, rawText, markdownContent, wordCount }`

---

### `urlValidator.ts` — SSRF protection

**`validateAndSanitizeUrl(rawUrl: string): Promise<URL>`**

- Parses URL, requires `http:` or `https:`
- Rejects `localhost`, `0.0.0.0` by hostname
- DNS-resolves the hostname and rejects:
  - Private IPv4: `10.x`, `172.16–31.x`, `192.168.x`, `127.x`, `169.254.x`, `100.64–127.x`
  - IPv6: `::1`, `fc/fd` (unique local), `fe80::` (link-local)
- Throws `ValidationError` on any failure

---

### `chunking.ts` — Text splitting + embedding

**`chunkAndEmbedArticle(articleId: string): Promise<void>`**

Constants: `CHUNK_SIZE = 1500`, `OVERLAP = 200`

1. Loads article `markdownContent`
2. Deletes existing chunks (idempotent)
3. Splits text — prefers `\n\n` boundaries, falls back to `. `, then hard split
4. For each chunk: calls `embedText(`search_document: {content}`)` via MLX
5. Bulk-inserts chunks with embeddings into `article_chunks`

---

### `llm.ts` — AI generation via Gemini

All functions use `gemini-2.0-flash-lite` (configurable via `GEMINI_MODEL`). Structured JSON output via Gemini's `responseMimeType: application/json` + `responseSchema`. Each function retries once after 500ms on failure.

Input is truncated to first 30,000 chars of `rawText`.

| Function | Output | Prompt intent |
|---|---|---|
| `generateDeck(rawText, count)` | `FlashCard[]` | N Q&A pairs covering key concepts |
| `generateQuiz(rawText, count)` | `QuizQuestion[]` | N multiple-choice questions, 4 options each |
| `generateSummary(rawText)` | `{ keyPoints, overview }` | 3–5 bullets + one paragraph |
| `gradeAnswer(question, modelAnswer, userAnswer)` | `GradeResponse` | Score 0–1 + feedback |

---

### `chatService.ts` — Chat orchestration

**`buildChatStream(query, context, history, sources, systemExtra?): AsyncGenerator<ChatEvent>`**

1. Attempts MLX `streamChat()` first
2. On `MlxUnavailableError`, falls back to Gemini streaming:
   - System instruction: "You are a helpful assistant..." + optional `systemExtra` hint (from `queryUnderstanding`)
   - Context injected into first user message
   - History roles mapped: `user→user`, `assistant→model`
3. Yields `{ type: 'token', text }` for each streamed token
4. Yields `{ type: 'sources', sources }` after completion
5. Yields `{ type: 'error', message }` if both providers fail

All retrieval context passed into this function is already filtered by `workspace_id` in the `chat.ts` route — this service is workspace-agnostic.

---

### `mlxClient.ts` — Local MLX service client

Base URL: `MLX_SERVICE_URL` (default `http://localhost:8001`). 5s timeout on all requests.

**`embedText(text: string): Promise<number[]>`**  
POST `/embed` → `{ text }` → returns 768-dim float array.

**`streamChat(query, context, history): AsyncGenerator<string>`**  
POST `/chat` → streams JSON-encoded tokens per line; stops on `[DONE]`.

Throws `MlxUnavailableError` on connection failure or timeout.

---

### `pdf.ts` — PDF generation

**`generatePdf(article: ArticleRow): Promise<PdfResponse>`**

1. Builds styled HTML (title, source, word count, markdown body)
2. Launches Puppeteer headless (`--no-sandbox` for container compat)
3. Sets HTML content, waits for `networkidle0`
4. Prints A4 PDF with 20mm margins → `{PDF_STORAGE_DIR}/{uuid}.pdf`
5. Enqueues `pdf_cleanup` job (1-hour delay)
6. Returns `{ url, expiresAt }`

---

### `pdfParser.ts` — PDF text extraction

**`parsePdf(buffer: Buffer): Promise<ParsedPdf>`**

- Uses `unpdf` to extract text from all pages
- Normalizes whitespace, groups into paragraphs
- Returns `{ rawText, markdownContent, wordCount }`

---

### `redis.ts` — Connection singletons

**`getRedis(): Redis`** — ioredis singleton (max 3 retries per request, lazy=false)  
**`getBullMQConnection()`** — Parses `REDIS_URL` for BullMQ; handles `rediss:` (TLS) and auth

---

## Workers (`apps/api/src/workers/`)

Workers are started in the main process (`index.ts`) and optionally in a standalone process (`workerEntry.ts`).

---

### Queue definitions (`queue.ts`)

| Queue | Attempts | Backoff |
|---|---|---|
| `extraction` | 2 | exponential, 2s base |
| `chunking` | 3 | exponential, 3s base |
| `pdf_cleanup` | 2 | exponential, 2s base |

```typescript
addExtractionJob(articleId, url)    // called by articles route
addChunkingJob(articleId)           // called by extraction worker + ingest routes
addPdfCleanupJob(articleId, filePath, delayMs)  // called by pdf service
```

---

### `extractionWorker.ts` — Concurrency 5

1. `validateAndSanitizeUrl(url)`
2. `extractArticle(url)` → `{ title, rawText, markdownContent, wordCount }`
3. Updates article: `status: ready`, content fields, `extractedAt`
4. `addChunkingJob(articleId)` (fire-and-forget)
5. On any failure: `status: failed`, `errorMessage` set

---

### `chunkingWorker.ts` — Concurrency 2

Calls `chunkAndEmbedArticle(articleId)`. Concurrency kept low because MLX embedding is CPU/memory-bound.

---

### `pdfCleanupWorker.ts` — Concurrency 3

Deletes the PDF file from disk. Silently ignores `ENOENT` (already deleted). Other errors propagate and trigger BullMQ retry.

---

### `workerEntry.ts` — Standalone worker process

Run via `pnpm worker`. Starts `ExtractionWorker` + `PdfCleanupWorker`. (ChunkingWorker is started from `index.ts` in the combined dev process.)

Handles `SIGTERM` / `SIGINT` for graceful shutdown.

---

## External Integrations

### Google Gemini

- Package: `@google/generative-ai`
- Auth: `GEMINI_API_KEY` env var
- Model: `GEMINI_MODEL` (default `gemini-2.0-flash-lite`)
- Used for: deck, quiz, summary generation; answer grading; chat fallback
- Output mode: structured JSON (`responseMimeType: application/json`)

### MLX Service (local, optional)

- Runs independently (not managed by this repo)
- Endpoints consumed: `POST /embed`, `POST /chat`
- Model: `nomic-embed-text-v1.5` for embeddings
- Used for: chunk embeddings, chat inference
- Fully optional — `MlxUnavailableError` triggers fallback to Gemini in all paths

### Web Extraction

- `@mozilla/readability` + `jsdom` — DOM parsing and article extraction
- `turndown` — HTML → Markdown conversion
- `unpdf` — PDF text extraction
- `puppeteer` — Headless Chrome for PDF generation
