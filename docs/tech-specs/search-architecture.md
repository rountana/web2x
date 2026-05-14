# Search Architecture & Dynamic Context Loading

**Last updated:** 2026-04-30  
**Status:** Implemented

---

## Problem

The original chat route did a flat top-8 semantic vector search across all user chunks regardless
of what the user was actually asking. This works well for specific questions ("what does this
article say about X?") but fails for temporal enumeration queries like **"summarize the articles
I read last week"** — that query needs to enumerate *all* articles in a date window, not
cherry-pick 8 chunks that happen to score highest by cosine similarity.

---

## Solution: Query Understanding Layer

Before any retrieval, the user's query is sent to a Gemini structured-output call
(`apps/api/src/services/queryUnderstanding.ts`) that classifies the query and returns:

```typescript
interface QueryIntent {
  retrieval_mode: 'semantic_search' | 'list_then_summarize' | 'hybrid';
  filters: {
    dateFrom?: string; // ISO 8601 — resolved from relative phrases like "last week"
    dateTo?: string;
  };
  reformulated_query: string; // temporal phrases stripped, semantic core preserved
  context_hint: string;       // one-sentence hint injected into the system prompt
}
```

If the Gemini call fails (network, quota), it falls back to `semantic_search` with no filters —
identical to the previous behavior.

---

## Retrieval Modes

### `semantic_search` (default)

- **When:** Specific content questions with no temporal scope.
- **Examples:** "what is RAG?", "explain the main argument of article X"
- **How:** Embed `reformulated_query`, find top-8 nearest chunks via pgvector `<=>` cosine
  distance, assemble context grouped by article.

### `list_then_summarize`

- **When:** User wants to enumerate or summarize articles within a time window.
- **Examples:** "summarize what I read last week", "what articles did I add this month?"
- **How:** Skip vector search entirely. Query `articles LEFT JOIN summaries` filtered by
  `created_at` range and `workspace_id`. For each article: use `summaries.overview` + `keyPoints`
  if available, otherwise truncate `markdownContent` to 1 200 chars. Respect the
  `MAX_CONTEXT_CHARS = 6 000` cap, stop after 20 articles.
- **Why not top-K:** With 12 articles in a week, top-8 chunks covers ~2–3 articles by chance.

### `hybrid`

- **When:** Topic question scoped to a time period.
- **Examples:** "what did I read last week about Python?", "any machine learning articles from
  last month?"
- **How:** Vector search (same as `semantic_search`) with an additional
  `AND a.created_at BETWEEN dateFrom AND dateTo` filter on the JOIN.

---

## Options Considered

### Option A: Client-side temporal regex (rejected)

Detect date phrases on the frontend before sending the request, pass explicit `dateFrom`/`dateTo`
query params. Simple but:
- Regex grows unboundedly (handles "last week" but misses "past fortnight", locale variations, etc.)
- Client must know the user's timezone
- Can't determine *retrieval mode* — it can only filter, not switch strategy

### Option B: Server-side regex (rejected as primary)

Same regex approach but on the backend. Better for timezone handling, still can't infer
retrieval mode. Used as the fallback approach before settling on Option C.

### Option C: LLM-assisted query decomposition ✓ (chosen)

Small Gemini call with structured JSON output. Resolves relative phrases to absolute ISO dates
using the injected current date. Returns both filters *and* retrieval mode, so the backend can
switch strategy based on intent. Gracefully falls back to `semantic_search` on failure.
Adds ~300–600 ms of latency on the first turn; subsequent turns in the same session could cache
the intent (not implemented in v1).

### Retrieval mode sub-choice: filtered chunk search vs list-then-summarize

| Approach | Pro | Con |
|---|---|---|
| Filtered chunk search | Simple — adds one SQL clause | Top-8 covers ~2–3 articles from a week of reading; rest silently missed |
| List-then-summarize | Complete coverage; uses pre-generated summaries | No semantic ranking within the window; may include irrelevant articles |

Chosen: **list-then-summarize** for `list_then_summarize` mode; **filtered chunk search** for
`hybrid` mode (user narrowed by topic, ranking by similarity matters more).

---

## Data Flow

```
User query
  │
  ▼
parseQueryIntent()   ← Gemini structured JSON call (with today's date injected)
  │                     Falls back to semantic_search on error
  ▼
retrieval_mode?
  │
  ├─ semantic_search ──► embedText(reformulated_query)
  │                       └─► pgvector top-8 chunks
  │                           WHERE workspace_id = $workspaceId  ← always scoped
  │                           [AND article_id = $articleId]      ← if provided
  │
  ├─ list_then_summarize ► articles LEFT JOIN summaries
  │                         WHERE workspace_id = $workspaceId
  │                           AND created_at IN [dateFrom, dateTo]
  │                         ORDER BY created_at DESC LIMIT 20
  │
  └─ hybrid ──────────────► embedText(reformulated_query)
                             └─► pgvector top-8 chunks
                                 WHERE workspace_id = $workspaceId
                                   AND created_at IN [dateFrom, dateTo]
  │
  ▼
buildChatStream(query, context, history, sources, context_hint)
  │  ├─ MLX primary (local Llama)
  │  └─ Gemini fallback
  ▼
SSE token stream → client
```

---

## Files Changed

| File | Change |
|---|---|
| `apps/api/src/services/queryUnderstanding.ts` | **New** — Gemini intent parser |
| `apps/api/src/services/chatService.ts` | Added optional `systemExtra` param to `buildChatStream` |
| `apps/api/src/routes/chat.ts` | Retrieval branches on `retrieval_mode`; imports `summaries` table |
| `packages/shared/src/index.ts` | Added `RetrievalMode`, `ChatFilters`, `QueryIntent` types |
| `apps/web/src/components/HomeChat.tsx` | **New** — inline chat widget on the home page |
| `apps/web/src/pages/HomePage.tsx` | Renders `<HomeChat />` between ingestion form and article list |

---

## Limitations & Future Work

- **Intent caching:** The Gemini call runs on every first message. Caching the intent per
  session would eliminate the extra latency for follow-up questions.
- **`articleId` scoping:** When a specific `articleId` is passed (chat from article detail page),
  query understanding is skipped entirely — the single-article scope already constrains retrieval.
- **`list_then_summarize` ranking:** Articles are returned by `created_at DESC`. A future
  improvement could add a light relevance re-rank using the `reformulated_query` embedding.
- **Timezone:** `dateFrom`/`dateTo` are resolved by the LLM using UTC. User timezone support
  would require the client to pass its UTC offset.
