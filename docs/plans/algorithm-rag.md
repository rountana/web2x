# Algorithm Plan — RAG Strategy (Composer)

**Phase:** 2  
**Status:** Planning  
**Spec:** [search-algorithms.md](../tech-specs/dev-features/search-algorithms.md#module-4--rag)  
**Phasewise plan:** [search-algorithms-implementation-plan.md](./search-algorithms-implementation-plan.md) — Tasks 2.1, 2.2

---

## What it does

Wraps any `SearchStrategy` with a generate step. The retriever produces chunks; RAG assembles
them into a context block and hands it to `buildChatStream` for Gemini generation. Swapping
the inner retriever changes the grounding source without touching generation logic.

This is a **composer**, not a peer strategy — its output is a streaming generator, not
`SearchResult[]`.

---

## Prerequisites

- Phase 1 complete: all of Vector, BM25, Hybrid, and the registry must be in place
- `buildChatStream` already exists in `apps/api/src/services/chatService.ts` and is unchanged
- Task 1.1 complete: shared types including `SearchQuery`, `SearchResult`, `SearchStrategy`

---

## Tasks

### Task R-1 — Create ragStrategy.ts
**New file:** `apps/api/src/services/search/ragStrategy.ts`

`RagStrategy` is constructed with:
- `retriever: SearchStrategy` — the pluggable retrieval module
- `maxContextChars: number` — defaults to `6000` (matching current `MAX_CONTEXT_CHARS` in
  `chat.ts`)

The module exposes a single async generator method:
`stream(query: SearchQuery, history, contextHint): AsyncGenerator<ChatStreamEvent>`

Internal steps:

**Step 1 — Retrieve**  
Call `this.retriever.search(query)` to get `SearchResult[]`.

**Step 2 — Assemble context**  
Group results by `articleId`. For each group, build a block: article title as a heading,
then all chunk contents concatenated. Respect `maxContextChars` — stop adding blocks when the
running total would exceed the limit. Collect `sources` list as `{ articleId, title }[]`.

**Step 3 — Generate**  
Call `buildChatStream(query.text, context, history, sources, contextHint)` from
`chatService.ts` and yield its events directly. No changes to `buildChatStream` are needed.

The strategy also implements `SearchStrategy` minimally for registry compatibility:
- `name`: `'rag'`
- `supports()`: true for `'rag'`
- `search()`: delegates to `retriever.search()` — returns raw results without generating

### Task R-2 — Wire RAG in chat.ts
**File:** `apps/api/src/routes/chat.ts`

Add a new branch for `retrieval_mode === 'rag'`:
- Determine the inner retriever: check `SearchQuery.options.rag_retriever` if present,
  otherwise default to `HybridStrategy` from the registry
- Construct a `RagStrategy` with the resolved retriever
- Call `ragStrategy.stream(searchQuery, history, context_hint)` and pipe its events to the
  SSE stream — identical plumbing to the current `buildChatStream` loop

The existing `list_then_summarize` and `semantic_search`/`hybrid` branches remain unchanged.

### Task R-3 — Register in registry.ts
**File:** `apps/api/src/services/search/registry.ts`

Add `RagStrategy` under the `'rag'` key, constructed with `HybridStrategy` as the default
inner retriever.

### Task R-4 — Update queryUnderstanding.ts
**File:** `apps/api/src/services/queryUnderstanding.ts`

Add `'rag'` as a valid `retrieval_mode`. Update the Gemini prompt to select `rag` when:
- The query includes words like "explain", "summarise", "tell me about", "what does X mean"
- The user is asking for a synthesised answer rather than a list of matching passages

---

## Files touched

| File | Change type |
|---|---|
| `apps/api/src/services/search/ragStrategy.ts` | New |
| `apps/api/src/services/search/registry.ts` | Modify — register RagStrategy |
| `apps/api/src/routes/chat.ts` | Modify — add `rag` branch |
| `apps/api/src/services/queryUnderstanding.ts` | Modify — add `'rag'` to enum + prompt |

---

## Verification

- `POST /workspaces/:id/chat { "query": "explain what I read about transformer models" }` →
  intent should classify as `rag`; response should be a generated prose answer with sources
- Swap inner retriever to BM25 via `options.rag_retriever = 'bm25'`; confirm the response
  only cites exact-match chunks
- With no chunks retrieved (empty corpus or MLX down), response should fall through
  gracefully — the generate step runs with empty context, not a 500

---

## Risks

- The context assembly logic (step 2) is currently duplicated inline in `chat.ts`. After this
  task, `chat.ts` should import it from `ragStrategy.ts` to avoid two diverging copies.
- `RagStrategy.stream()` starts a Gemini API call. If the inner retriever is slow (e.g.
  Knowledge Graph with 2-hop traversal), total latency stacks. Document the latency budget
  in the spec.
