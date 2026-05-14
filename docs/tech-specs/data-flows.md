# Data Flows

## 1. URL Ingestion

```
User pastes URL on HomePage (active workspace already bootstrapped)
  │
  ▼
api.articles.create(url)  →  POST /api/v1/articles
  x-anon-id: <uuid>
  x-workspace-id: <active-workspace-uuid>
  │
  ▼
workspaceMiddleware:
  validates x-anon-id + x-workspace-id; stashes workspace on context
  │
  ▼
articles route:
  validateAndSanitizeUrl()   ← SSRF check (DNS + IP range)
  INSERT articles (status=pending, sourceUrl, workspaceId=workspace.id, userId=workspace.userId)
  addExtractionJob(articleId, url)
  return { id, status: 'pending' }  202
  │
  ▼
Navigate to /processing/:id
  ProcessingPage polls GET /articles/:id every 2s
  │
  ▼  [BullMQ — extraction queue]
ExtractionWorker:
  validateAndSanitizeUrl()
  fetch(url, { timeout: 15s })
  JSDOM parse → Readability extract
  Turndown convert HTML → markdown
  strip markdown → rawText, wordCount
  UPDATE articles SET status=ready, title, rawText, markdownContent, wordCount, extractedAt
  addChunkingJob(articleId)
  │
  ▼  [BullMQ — chunking queue]
ChunkingWorker:
  DELETE existing article_chunks (idempotent)
  splitIntoChunks(markdownContent)  ← 1500 chars, 200 overlap
  for each chunk:
    embedText(`search_document: ${content}`)  →  MLX /embed
    INSERT article_chunks (content, embedding, chunkIndex)
  │
  ▼
ProcessingPage detects status=ready → navigate to /articles/:id
```

**Failure path:** ExtractionWorker catches error → `UPDATE articles SET status=failed, errorMessage`. ProcessingPage shows error with message.

---

## 2. PDF Upload Ingestion

```
User uploads PDF on HomePage (active workspace already bootstrapped)
  │
  ▼
POST /api/v1/articles/ingest/pdf  (multipart, max 10MB)
  x-anon-id: <uuid>
  x-workspace-id: <active-workspace-uuid>
  │
  ▼
workspaceMiddleware: validates headers, stashes workspace
  │
  ▼
ingest route:
  parsePdf(buffer)   ← unpdf extracts text from all pages
  INSERT articles (status=ready, rawText, markdownContent, wordCount, title,
                   workspaceId=workspace.id, userId=workspace.userId)
  addChunkingJob(articleId)
  return { id, status: 'pending' }  201
  │
  ▼  [ChunkingWorker — same as step above]
```

No extraction worker needed — content is available immediately.

---

## 3. AI Generation (Deck / Quiz / Summary)

All three features follow the same pattern:

```
User navigates to /articles/:id/flashcards
  │
  ▼
useCreateDeck() mutation fires on mount
  POST /api/v1/articles/:id/deck  { count: 10 }
  │
  ▼
deck route:
  GET article (must be status=ready)
  SELECT FROM decks WHERE articleId = id
  if exists → return cached deck (no Gemini call)
  │
  ▼  (if no deck)
generateDeck(article.rawText, count):
  Gemini request:
    model: gemini-2.0-flash-lite
    input: first 30k chars of rawText
    responseSchema: { cards: [{ front, back }] }
  parse JSON response
  INSERT deck { articleId, cards }
  return deck
  │
  ▼
CardDeck component renders flip/swipe UI
```

---

## 4. RAG Chat

```
User types query in ChatPage
  │
  ▼
POST /api/v1/chat  { query, articleId?, history }
  x-anon-id: <uuid>
  x-workspace-id: <active-workspace-uuid>
  │
  ▼
workspaceMiddleware: validates headers, stashes workspace
  │
  ▼
chat route:
  embedText(`search_query: ${query}`)  →  MLX /embed  →  768-dim vector
  │
  ▼
  raw SQL vector search:
    SELECT ac.content, ac.article_id, a.title,
           ac.embedding <=> $1::vector AS distance
    FROM article_chunks ac
    JOIN articles a ON a.id = ac.article_id
    WHERE ac.embedding IS NOT NULL
      AND a.workspace_id = $2::uuid   ← always filtered by workspace
      [AND ac.article_id = $3]        ← if articleId provided
    ORDER BY distance ASC
    LIMIT 8
  │
  ▼
  assemble context: group chunks by article, concat up to 6000 chars
  │
  ▼
buildChatStream(query, context, history, sources):
  try:
    streamChat() via MLX /chat  →  SSE token stream
  catch MlxUnavailableError:
    Gemini.generateContentStream()  →  token stream
  │
  ▼
SSE response to browser:
  event: token  data: "Hello"
  event: token  data: " world"
  event: sources  data: [{"articleId":...,"title":...}]
  │
  ▼
ChatPage accumulates tokens → renders markdown response + source badges
```

**Retrieval always scoped to workspace:** The `workspace_id` filter on all vector and list queries guarantees cross-workspace data leaks are not possible. MLX unavailable → embedding fails → empty chunks → context-free Gemini chat.

---

## 5. PDF Generation

```
User clicks "PDF" on ArticleDetailPage
  │
  ▼
POST /api/v1/articles/:id/pdf
  │
  ▼
pdf route:
  article must be status=ready
  generatePdf(article):
    build HTML (title, source, word count, markdown body)
    Puppeteer: launch headless Chrome
    page.setContent(html), waitForNetworkIdle
    page.pdf({ format: A4, margins: 20mm })
    write to uploads/pdfs/{uuid}.pdf
    addPdfCleanupJob(articleId, filePath, 3600_000ms)
    return { url: "http://…/pdfs/{uuid}.pdf", expiresAt }
  │
  ▼
browser opens URL in new tab → downloads PDF
  │
  ▼  [1 hour later — BullMQ pdf_cleanup queue]
PdfCleanupWorker:
  fs.unlink(filePath)
```

---

## 6. Answer Grading

```
User submits open-ended answer in QuizPage
  │
  ▼
POST /api/v1/articles/:id/quiz/grade
  { questionId, userAnswer }
  │
  ▼
quiz route:
  load quiz, find question by id
  gradeAnswer(question.question, question.correctAnswer, userAnswer):
    Gemini prompt: compare student answer to model answer
    responseSchema: { correct: bool, score: 0-1, feedback: string }
  return GradeResponse
  │
  ▼
QuizPage shows score bar + feedback text
```

---

## 7. PWA Share Target (Mobile)

```
User shares URL from any app (Chrome, Twitter, etc.)
  OS share sheet  →  selects "web2x" (PWA installed)
  │
  ▼
GET /share-target?url=https://example.com/article
  │
  ▼
shareTarget route (backend):
  validates url param (basic presence check)
  redirect 302 → frontend SPA /share-target?url=...
  (backend cannot know the active workspace; redirect to frontend to handle)
  │
  ▼
ShareTargetPage (frontend React):
  reads ?url= param
  calls api.articles.create(url)  ← includes x-workspace-id from localStorage
  shows spinner during submission
  on success → navigate to /processing/:id
  │
  ▼
[same as URL ingestion flow from step 1 onward]
```
