# API Reference

Base path: `/api/v1`  
Server port: `3001` (configurable via `API_PORT`)

## Required Headers

| Header | Required for | Notes |
|---|---|---|
| `x-anon-id` | All routes | UUID stored in browser `localStorage`; identifies the anonymous user |
| `x-workspace-id` | All article/chat/ingest routes | UUID of the active workspace; validated against `x-anon-id` ownership |

Workspace CRUD routes (`/workspaces`) require only `x-anon-id`.  
The PDF download route (`/pdfs/:filename`) and `/health` require neither.

---

## Middleware

### Rate Limiting (`middleware/rateLimit.ts`)

Disabled when `NODE_ENV=development`.

| Limit | Scope | Key | Value |
|---|---|---|---|
| Global | Per IP | `rl:ip:{ip}` from `x-forwarded-for` | 10 req / hour |
| LLM | Per anon user | `rl:llm:{anonId or ip}` | 5 req / hour |

LLM paths (POST only): `/deck`, `/quiz`, `/summary`, `/pdf`, `/chat`

**429 response:**
```json
{ "error": "Rate limit exceeded", "code": "RATE_LIMIT" }
{ "error": "LLM rate limit exceeded", "code": "LLM_RATE_LIMIT" }
```

### Workspace Middleware (`middleware/workspace.ts`)

Applied to all routes under the workspace-scoped sub-app (articles, chat, ingest, deck, quiz, summary, pdf, md).

1. Reads `x-workspace-id` and `x-anon-id` from headers
2. Queries `workspaces WHERE id=$workspaceId AND user_id=$userId`
3. Stashes the workspace row on Hono context (`c.set('workspace', workspace)`) for downstream handlers
4. Returns 400 if either header is missing; 404 if workspace not found or doesn't belong to the user

### Error Handler (`middleware/error.ts`)

| Error class | HTTP | `code` field |
|---|---|---|
| `ValidationError` | 400 | `VALIDATION_ERROR` |
| `NotFoundError` | 404 | `NOT_FOUND` |
| Unhandled | 500 | `INTERNAL_ERROR` |

---

## Health

```
GET /health
```

Response:
```json
{ "status": "ok", "timestamp": "2026-04-30T..." }
```

---

## Workspaces

All workspace endpoints require `x-anon-id`. They do **not** require `x-workspace-id`.

### Create Workspace

```
POST /api/v1/workspaces
Content-Type: application/json
x-anon-id: <uuid>

{ "name": "Research" }
```

- `name`: 1–100 chars, trimmed
- Returns **201**

```json
{ "id": "uuid", "name": "Research" }
```

### List Workspaces

```
GET /api/v1/workspaces
x-anon-id: <uuid>
```

Returns all workspaces for this anonymous user, ordered by `created_at ASC`.

```json
{
  "workspaces": [
    { "id": "uuid", "userId": "...", "name": "Research", "createdAt": "...", "updatedAt": "..." }
  ]
}
```

### Get Workspace

```
GET /api/v1/workspaces/:id
x-anon-id: <uuid>
```

Returns 404 if the workspace doesn't exist or belongs to a different user.

### Rename Workspace

```
PATCH /api/v1/workspaces/:id
Content-Type: application/json
x-anon-id: <uuid>

{ "name": "Work Projects" }
```

Returns the updated workspace object. 404 if not found.

### Delete Workspace

```
DELETE /api/v1/workspaces/:id
x-anon-id: <uuid>
```

- Cascades: deletes all articles, chunks, decks, quizzes, and summaries in the workspace
- Returns 400 with `{ "code": "LAST_WORKSPACE" }` if this is the user's only workspace
- Returns `{ "success": true }` on success

---

## Articles

All article routes require both `x-anon-id` and `x-workspace-id`.

### Create from URL

```
POST /api/v1/articles
Content-Type: application/json
x-anon-id: <uuid>
x-workspace-id: <uuid>

{ "url": "https://example.com/article" }
```

- Validates URL (SSRF check — rejects private IPs)
- Creates article record (`status: pending`, `workspaceId` from middleware)
- Enqueues `extraction` job
- Returns **202**

```json
{ "id": "uuid", "status": "pending" }
```

### Ingest Markdown

```
POST /api/v1/articles/ingest/markdown
Content-Type: application/json
x-anon-id: <uuid>
x-workspace-id: <uuid>

{ "content": "# Title\n\nBody text...", "title": "Optional override" }
```

- `content` max 500,000 chars
- Extracts title from H1 if `title` not provided
- Sets `status: ready` immediately; enqueues `chunking` job
- Returns **201**

```json
{ "id": "uuid", "status": "pending" }
```

### Ingest PDF

```
POST /api/v1/articles/ingest/pdf
Content-Type: multipart/form-data
x-anon-id: <uuid>
x-workspace-id: <uuid>

file: <pdf binary>
title: "Optional title"
```

- Max 10 MB; parses PDF text via `unpdf`
- Sets `status: ready` immediately; enqueues `chunking` job
- Returns **201**

### List Articles

```
GET /api/v1/articles?page=1
x-anon-id: <uuid>
x-workspace-id: <uuid>
```

Returns 20 per page, filtered by `workspace_id`.

```json
{
  "articles": [{ "id": "...", "title": "...", "status": "ready", ... }],
  "total": 42,
  "page": 1,
  "pageSize": 20
}
```

### Get Article

```
GET /api/v1/articles/:id
x-anon-id: <uuid>
x-workspace-id: <uuid>
```

Returns full article record including `markdownContent`, `rawText`, `wordCount`. 404 if article doesn't belong to the active workspace.

### Get Chunk Count

```
GET /api/v1/articles/:id/chunks
x-anon-id: <uuid>
x-workspace-id: <uuid>
```

```json
{ "count": 12 }
```

Returns the number of embedded chunks. Used by the frontend to show "building search index" state.

### Delete Article

```
DELETE /api/v1/articles/:id
x-anon-id: <uuid>
x-workspace-id: <uuid>
```

Cascades to all child tables (chunks, summaries, decks, quizzes). 404 if article doesn't belong to the workspace.

```json
{ "success": true }
```

---

## Flashcards

All deck routes require both headers.

### Generate Deck

```
POST /api/v1/articles/:id/deck
Content-Type: application/json
x-anon-id: <uuid>
x-workspace-id: <uuid>

{ "count": 10 }   // optional, 5–20, default 10
```

- Article must have `status: ready` and belong to the active workspace
- Returns existing deck if already generated (idempotent)
- Calls Gemini with structured JSON output; LLM rate limit applies

```json
{
  "id": "uuid",
  "articleId": "uuid",
  "cards": [{ "front": "Q?", "back": "A." }],
  "generatedAt": "..."
}
```

### Get Deck

```
GET /api/v1/articles/:id/deck
x-anon-id: <uuid>
x-workspace-id: <uuid>
```

---

## Quiz

### Generate Quiz

```
POST /api/v1/articles/:id/quiz
Content-Type: application/json
x-anon-id: <uuid>
x-workspace-id: <uuid>

{ "count": 8 }   // optional, 3–15, default 8
```

Returns:
```json
{
  "id": "uuid",
  "questions": [{
    "id": "uuid",
    "type": "multiple_choice",
    "question": "...",
    "options": ["A", "B", "C", "D"],
    "correctAnswer": "A",
    "explanation": "..."
  }]
}
```

### Get Quiz

```
GET /api/v1/articles/:id/quiz
x-anon-id: <uuid>
x-workspace-id: <uuid>
```

### Grade Answer

```
POST /api/v1/articles/:id/quiz/grade
Content-Type: application/json
x-anon-id: <uuid>
x-workspace-id: <uuid>

{ "questionId": "uuid", "userAnswer": "The answer is..." }
```

Only grades open-ended questions. Calls Gemini to compare against model answer.

```json
{ "correct": true, "score": 0.85, "feedback": "Good. You identified..." }
```

---

## Summary

### Generate Summary

```
POST /api/v1/articles/:id/summary
x-anon-id: <uuid>
x-workspace-id: <uuid>
```

```json
{
  "id": "uuid",
  "keyPoints": ["Point 1", "Point 2", "Point 3"],
  "overview": "One paragraph prose..."
}
```

### Get Summary

```
GET /api/v1/articles/:id/summary
x-anon-id: <uuid>
x-workspace-id: <uuid>
```

---

## PDF

### Generate PDF

```
POST /api/v1/articles/:id/pdf
x-anon-id: <uuid>
x-workspace-id: <uuid>
```

Renders article via Puppeteer. PDF stored on disk with UUID filename (acts as token). Auto-deleted after 1 hour.

```json
{ "url": "http://localhost:3001/api/v1/pdfs/{uuid}.pdf", "expiresAt": "..." }
```

### Download PDF

```
GET /api/v1/pdfs/:filename
```

- No auth required — UUID filename acts as unguessable token
- `filename` must match UUID pattern `[\da-f-]{36}\.pdf`
- Returns PDF binary with `Content-Type: application/pdf`
- 404 if file expired or doesn't exist

---

## Chat (RAG)

```
POST /api/v1/chat
Content-Type: application/json
x-anon-id: <uuid>
x-workspace-id: <uuid>

{
  "query": "What does the article say about X?",
  "articleId": "uuid",         // optional — scope to one article within workspace
  "history": [                 // optional, max 20 messages
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ]
}
```

Returns a **Server-Sent Events** stream:

```
event: token
data: "Hello"

event: token
data: " world"

event: sources
data: [{"articleId":"uuid","title":"Article Name"}]

event: error
data: "Something went wrong"
```

**Pipeline:**
1. Parses query intent via `parseQueryIntent()` (Gemini structured call) — skipped when `articleId` is provided
2. For `semantic_search` / `hybrid`: embeds query via MLX, vector searches `article_chunks` filtered by `workspace_id` (and optionally `articleId` + date range)
3. For `list_then_summarize`: queries `articles LEFT JOIN summaries` filtered by `workspace_id` and date window
4. Assembles context (max 6,000 chars)
5. Streams response via MLX → fallback to Gemini

All retrieval is scoped to `workspace_id`. Cross-workspace data leaks are not possible.

---

## Markdown View

```
GET /api/v1/articles/:id/md
x-anon-id: <uuid>
x-workspace-id: <uuid>
```

Returns a standalone HTML page that renders the article's markdown content. Uses `marked.js` via CDN for client-side rendering. 404 if article doesn't belong to the workspace.

---

## Share Target

```
GET /api/v1/share-target?url=https://example.com/article
```

Backend route only; redirects browser to the frontend `/share-target?url=...` SPA route, which handles article creation with the active workspace context via the API client.

- No auth required on this endpoint
- Invalid or missing URL → redirect to `/?error=no-url` or `/?error=invalid-url`

---

## Error Shapes

All errors return JSON:
```json
{ "error": "Human-readable message", "code": "MACHINE_CODE" }
```

Common codes: `VALIDATION_ERROR`, `NOT_FOUND`, `RATE_LIMIT`, `LLM_RATE_LIMIT`, `MISSING_WORKSPACE`, `LAST_WORKSPACE`, `INTERNAL_ERROR`
