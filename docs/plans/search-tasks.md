# Search Algorithms — Task List (All Phases)

**Spec:** [tech-specs/dev-features/search-algorithms.md](../tech-specs/dev-features/search-algorithms.md)  
**Implementation plan:** [search-algorithms-implementation-plan.md](./search-algorithms-implementation-plan.md)  
**Last updated:** 2026-05-02

Legend: ✅ done · ⬜ pending · 🔒 blocked

---

## Phase 1 — Core Retrieval Contract

> Goal: lock the shared interface, extract Vector, add BM25 + Hybrid, wire chat.ts to a strategy registry. Chat endpoint must behave identically after this phase.

| ID | Task | File(s) | Status |
|---|---|---|---|
| 1.1 | Extend shared types — add `QueryType`, `MetadataFilter`, `SearchQuery`, `SearchResult`, `SearchStrategy`; extend `RetrievalMode` | `packages/shared/src/index.ts` | ✅ |
| 1.2 | Metadata filter utility — `buildMetadataWhere(filters, alias)`, v1 scope: workspaceId + date | `services/search/metadataFilter.ts` | ✅ |
| 1.3 | Vector strategy — extract pgvector cosine search from `chat.ts:105–148` into `SearchStrategy` module | `services/search/vectorStrategy.ts` | ✅ |
| 1.4a | BM25 migration — `search_vector tsvector GENERATED ALWAYS AS … STORED` + GIN index on `article_chunks` | `db/migrations/0003_bm25_tsvector.sql` | ✅ |
| 1.4b | BM25 Drizzle schema — add `tsvector` custom type + `searchVector` column to `articleChunks` table | `db/schema.ts` | ✅ |
| 1.4c | BM25 strategy — `websearch_to_tsquery` + `ts_rank_cd`, normalise scores to [0,1] | `services/search/bm25Strategy.ts` | ✅ |
| 1.5 | Hybrid strategy — run BM25 + Vector in parallel, merge via RRF (`rrf_k = 60`) | `services/search/hybridStrategy.ts` | ✅ |
| 1.6 | Strategy registry — `resolveStrategy(mode)` mapping `QueryType` → singleton module | `services/search/registry.ts` | ✅ |
| 1.7 | Update queryUnderstanding — extend Gemini prompt + `VALID_MODES` to include `bm25`, `vector`, `hybrid`, `rag`, `csv`, `knowledge_graph` | `services/queryUnderstanding.ts` | ✅ |
| 1.8 | Refactor chat.ts — replace inline retrieval if/else with `resolveStrategy(mode).search()` | `routes/chat.ts` | ✅ |

**Phase 1 verify:**
- `POST /chat { "query": "explain RAG" }` returns same answer as before refactor
- `POST /chat { "query": "Python articles last week" }` date-filtered result unchanged
- `POST /chat { "query": "\"pgvector\" HNSW" }` routes to BM25 (check logs)

---

## Phase 2 — RAG Composer

> Goal: formalise the retrieve → assemble → generate pipeline as a composable module so any retriever can be swapped without touching generation logic.

| ID | Task | File(s) | Status |
|---|---|---|---|
| 2.1 | RAG strategy — wrap any `SearchStrategy` retriever, assemble context, delegate to `buildChatStream` | `services/search/ragStrategy.ts` | ✅ |
| 2.2 | Register RAG — add `'rag'` to registry with `HybridStrategy` as default inner retriever | `services/search/registry.ts` | ✅ |
| 2.3 | Wire RAG in chat.ts — extract context-assembly into `assembleRagContext`, route `rag` mode through registry | `routes/chat.ts` | ✅ |
| 2.4 | Update queryUnderstanding — `'rag'` detection heuristics already added in Task 1.7 | `services/queryUnderstanding.ts` | ✅ |

**Phase 2 verify:**
- `POST /chat { "query": "explain what I read about transformer models" }` → intent = `rag`, returns generated prose with sources
- Swap inner retriever to `bm25` via `options.rag_retriever`; response cites only exact-match chunks
- Empty corpus → degrades gracefully, no 500

---

## Phase 3 — CSV Module

> Goal: let users upload a CSV and search its rows via structured column filters + BM25 on free-text columns.

| ID | Task | File(s) | Status |
|---|---|---|---|
| 3.1 | CSV migration — create `csv_uploads` + `csv_rows` tables, GIN indexes on `search_vector` and `metadata` | `db/migrations/0004_csv_tables.sql` | ✅ |
| 3.2 | CSV Drizzle schema — add `csvUploads` + `csvRows` table definitions | `db/schema.ts` | ✅ |
| 3.3 | CSV strategy — column-value JSONB predicates + BM25 free-text fallback, two-tier scoring | `services/search/csvStrategy.ts` | ✅ |
| 3.4 | CSV upload route — `POST /csv/upload` (schema inference, batch row insert), `GET /csv`, `DELETE /csv/:id` | `routes/csv.ts` | ✅ |
| 3.5 | Register CSV strategy + mount route — add to registry, mount in `app.ts` (queryUnderstanding done in 1.7) | `registry.ts`, `app.ts` | ✅ |

**Phase 3 verify:**
- Upload a task-list CSV; `GET /csv` returns it with correct `rowCount`
- `POST /chat { "query": "rows where status = done" }` returns matched rows
- `DELETE /csv/:id` cascades to `csv_rows`

---

## Phase 4 — Knowledge Graph

> Goal: entity-centric search. Gemini extracts entity–relation triples at ingest; graph traversal surfaces related articles at query time.

| ID | Task | File(s) | Status |
|---|---|---|---|
| 4.1 | KG migration — create `entities`, `triples`, `article_entities` tables + `entity_type` enum, all required indexes | `db/migrations/0005_knowledge_graph.sql` | ⬜ |
| 4.2 | KG Drizzle schema — add `entityTypeEnum`, `entities`, `triples`, `articleEntities` table definitions | `db/schema.ts` | 🔒 needs 4.1 |
| 4.3 | Entity extraction service — Gemini structured-output call, upsert entities by canonical name, insert triples + `article_entities` | `services/entityExtractor.ts` | 🔒 needs 4.2 |
| 4.4 | Entity extraction BullMQ worker — `entity_extraction` queue, worker that calls `extractEntities(articleId)` | `workers/entityExtractionWorker.ts`, `workers/queue.ts` | 🔒 needs 4.3 |
| 4.5 | Trigger extraction after chunking — enqueue `entity_extraction` job at end of `chunkingWorker.ts` | `workers/chunkingWorker.ts` | 🔒 needs 4.4 |
| 4.6 | Knowledge Graph strategy — NER on query via Gemini, entity resolution, 1-hop + optional 2-hop traversal, scoring | `services/search/knowledgeGraphStrategy.ts` | 🔒 needs 4.2 |
| 4.7 | Register KG strategy + update queryUnderstanding — add heuristics for entity-centric queries | `registry.ts`, `queryUnderstanding.ts` | 🔒 needs 4.6 |

**Phase 4 verify:**
- Ingest article; confirm `entity_extraction` job completes; `entities` + `article_entities` populated
- `POST /chat { "query": "articles mentioning OpenAI" }` returns entity-matched articles
- `POST /chat { "query": "articles related to Sam Altman" }` triggers 2-hop traversal

---

## Summary

| Phase | Total tasks | Done | Remaining |
|---|---|---|---|
| 1 — Core retrieval | 10 | 10 | 0 |
| 2 — RAG composer | 4 | 4 | 0 |
| 3 — CSV module | 5 | 5 | 0 |
| 4 — Knowledge Graph | 7 | 0 | 7 |
| **Total** | **26** | **19** | **7** |
