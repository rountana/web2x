# Algorithm Plan — Vector Strategy

**Phase:** 1 (Core Retrieval Contract)  
**Status:** Planning  
**Spec:** [search-algorithms.md](../tech-specs/dev-features/search-algorithms.md#module-3--vector)  
**Phasewise plan:** [search-algorithms-implementation-plan.md](./search-algorithms-implementation-plan.md) — Tasks 1.1, 1.2, 1.3, 1.6, 1.7, 1.8

---

## What it does

Semantic similarity search over article chunks using dense vector embeddings stored in
pgvector. Converts the user's query to an embedding via the local MLX service, then finds the
top-K most similar chunks by cosine distance. This is the primary retrieval mode for
open-ended conceptual questions.

---

## Prerequisites

- Task 1.1 complete: `SearchQuery`, `SearchResult`, `SearchStrategy`, `QueryType` types
  exported from `packages/shared/src/index.ts`
- Task 1.2 complete: `buildMetadataWhere` utility available at
  `apps/api/src/services/search/metadataFilter.ts`
- Existing infrastructure already in place: `article_chunks.embedding vector(768)` column,
  HNSW index, `embedText()` in `mlxClient.ts`

---

## Tasks

### Task V-1 — Create vectorStrategy.ts
**New file:** `apps/api/src/services/search/vectorStrategy.ts`

Extract the pgvector cosine search that currently lives inline in `apps/api/src/routes/chat.ts`
(lines 105–148) into this module. No query logic changes — it moves home.

What the module must do:
- Accept a `SearchQuery` and call `embedText()` with the `search_query:` prefix
- Execute the `embedding <=> vector` cosine distance query against `article_chunks`, joined
  to `articles` for title and workspace scoping
- Apply date filters from `SearchQuery.filters` via `buildMetadataWhere`
- Support optional `articleId` scoping (single-article chat path)
- Normalise cosine distance to a `[0, 1]` score (`score = 1 − distance`)
- Return `SearchResult[]` with `source: 'vector'`
- Handle `MlxUnavailableError` gracefully — return an empty array so callers degrade cleanly
- `name`: `'vector'`
- `supports()`: true for `'vector'` and `'semantic_search'`
- `score()`: identity — scores already set during search

### Task V-2 — Register in registry.ts
**File:** `apps/api/src/services/search/registry.ts`

Add `VectorStrategy` under both `'vector'` and `'semantic_search'` keys.

### Task V-3 — Update chat.ts to use VectorStrategy
**File:** `apps/api/src/routes/chat.ts`

In the `else` branch (semantic_search / hybrid), replace the inline pgvector block with a
call to `resolveStrategy(retrieval_mode).search(searchQuery)`. The context assembly and SSE
streaming that follows the retrieval call remain unchanged.

---

## Files touched

| File | Change type |
|---|---|
| `apps/api/src/services/search/vectorStrategy.ts` | New |
| `apps/api/src/services/search/registry.ts` | New (or modify if created earlier) |
| `apps/api/src/routes/chat.ts` | Modify — remove inline retrieval block, import and call VectorStrategy via registry |
| `packages/shared/src/index.ts` | Prerequisite — no further changes needed here |

---

## Verification

After implementing, the chat endpoint must be behaviourally identical to before:

- `POST /workspaces/:id/chat { "query": "explain vector search" }` → returns relevant chunks,
  same structure as today
- `POST /workspaces/:id/chat { "query": "anything", "articleId": "<uuid>" }` → single-article
  scoping still works
- With MLX service down → chat falls back gracefully (no 500), context is empty or uses
  markdown fallback

---

## Risks

- The only risk is regression: the extraction must be exact. Check that the `search_query:`
  prefix, the `LIMIT TOP_K`, and the `workspaceId` scope filter are all preserved.
- The `list_then_summarize` branch in `chat.ts` must not be touched in this task.
