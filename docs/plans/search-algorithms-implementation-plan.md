# Search Algorithms — Phasewise Implementation Plan

**Status:** Planning  
**Last updated:** 2026-05-02  
**Spec reference:** [docs/tech-specs/dev-features/search-algorithms.md](./tech-specs/dev-features/search-algorithms.md)

---

## Overview

Four sequential phases. Each phase is independently shippable and leaves the existing chat
endpoint functional throughout. Phases 3 and 4 are additive (new tables, new routes); they
do not touch existing routes.

```
Phase 1 — Core retrieval contract    (Vector · BM25 · Hybrid · Registry)
Phase 2 — RAG composer               (wraps Phase 1 retrievers + generate)
Phase 3 — CSV module                 (new tables · upload route · CSV strategy)
Phase 4 — Knowledge Graph            (new tables · entity extraction · KG strategy)
Phase 5 — Full Metadata columns      (schema expansion for sourceType · domain · language · tags)
```

---

## Phase 1 — Core Retrieval Contract

**Goal:** Lock the shared interface, extract the existing inline vector search into a module,
add BM25 and Hybrid (RRF), then wire `chat.ts` to dispatch through a strategy registry.
The chat endpoint must behave identically after this phase.

### Task 1.1 — Extend shared types
**File:** `packages/shared/src/index.ts`

Add the following types after the existing `QueryIntent` block:

```typescript
// ─── Search strategy contract ──────────────────────────────────────────────

export type QueryType =
  | 'semantic_search'        // existing — maps to Vector
  | 'list_then_summarize'    // existing — stays inline in chat.ts for now
  | 'hybrid'                 // extended — BM25 + Vector via RRF
  | 'bm25'
  | 'vector'
  | 'rag'
  | 'csv'
  | 'knowledge_graph';

export interface MetadataFilter {
  workspaceId: string;        // always required
  dateFrom?: string;          // ISO 8601
  dateTo?: string;            // ISO 8601
  // Phase 5: sourceType, domain, language, tags, readingTimeMin, readingTimeMax
}

export interface SearchQuery {
  text: string;
  workspaceId: string;
  articleId?: string;
  filters?: MetadataFilter;
  topK?: number;              // default 8
  options?: Record<string, unknown>;
}

export interface SearchResult {
  id: string;                 // chunk id or article id
  articleId: string;
  score: number;              // normalised to [0, 1]
  content: string;
  metadata: Record<string, unknown>;
  source: QueryType;
}

export interface SearchStrategy {
  name: QueryType;
  search(query: SearchQuery): Promise<SearchResult[]>;
  score(result: SearchResult): number;
  supports(queryType: QueryType): boolean;
}
```

Also extend `RetrievalMode` to include the new strategy names (keeping the existing three for
backward compatibility with `queryUnderstanding.ts`):

```typescript
export type RetrievalMode = QueryType;  // replaces the 3-value union
```

---

### Task 1.2 — Metadata filter utility
**New file:** `apps/api/src/services/search/metadataFilter.ts`

Exports a single function:

```typescript
buildMetadataWhere(filters: MetadataFilter, articleTableAlias?: string): SQL
```

**v1 scope** — only `workspaceId`, `dateFrom`, `dateTo`. Returns a composable `SQL` fragment
using Drizzle's `sql` tagged template. Every other module imports this and injects the result
into its own `WHERE` clause.

Phase 5 expands this function when the new article columns land.

---

### Task 1.3 — Vector strategy
**New file:** `apps/api/src/services/search/vectorStrategy.ts`

Extract the existing pgvector query from `apps/api/src/routes/chat.ts` lines 105–148 into a
`SearchStrategy` implementation. The query logic is unchanged — only its home moves.

Key details:
- Calls `embedText(`search_query: ${query.text}`)` from `mlxClient.ts`
- Executes the `embedding <=> $vector::vector` cosine search
- Applies `MetadataFilter` via `buildMetadataWhere`
- Normalises distance to score: `score = 1 - distance` (distance is already in [0, 1] for
  cosine)
- Handles `MlxUnavailableError` — returns `[]` so callers degrade gracefully
- `supports()`: returns `true` for `'vector'` and `'semantic_search'`

---

### Task 1.4 — BM25 strategy

**Sub-task 1.4a — Migration**  
**New file:** `apps/api/src/db/migrations/0003_bm25_tsvector.sql`

```sql
-- Add full-text search vector column
ALTER TABLE article_chunks
  ADD COLUMN search_vector tsvector
    GENERATED ALWAYS AS (to_tsvector('english', content)) STORED;

-- GIN index for fast phrase/term lookup
CREATE INDEX article_chunks_search_vector_idx
  ON article_chunks USING GIN(search_vector);
```

Using `GENERATED ALWAYS AS … STORED` means no trigger is needed — PostgreSQL maintains the
column automatically on insert and update.

**Sub-task 1.4b — Drizzle schema**  
**File:** `apps/api/src/db/schema.ts`

Add `searchVector` to the `articleChunks` table definition using a `customType` for
`tsvector`. Mark it as a generated column (Drizzle supports this via `.generatedAlwaysAs()`).

**Sub-task 1.4c — BM25 module**  
**New file:** `apps/api/src/services/search/bm25Strategy.ts`

Query flow:
1. Sanitise `query.text` — strip special `tsquery` operators to prevent syntax errors
2. Build a `websearch_to_tsquery('english', $query)` expression (safe, no manual escaping)
3. Execute ranked full-text search:
   ```sql
   SELECT ac.id, ac.article_id, ac.content,
          ts_rank_cd(ac.search_vector, query) AS rank
   FROM article_chunks ac,
        websearch_to_tsquery('english', $text) query
   JOIN articles a ON a.id = ac.article_id
   WHERE ac.search_vector @@ query
     AND [MetadataFilter clauses]
   ORDER BY rank DESC
   LIMIT $topK
   ```
4. Normalise rank to [0, 1]: divide by the max rank in the result set
5. `supports()`: returns `true` for `'bm25'`

Note: `ts_rank_cd` is PostgreSQL's built-in ranker. It approximates BM25 but is not identical.
The `pg_bm25` extension (true Okapi BM25) is the upgrade path — flagged in `techdebt.md`.

---

### Task 1.5 — Hybrid strategy (RRF)
**New file:** `apps/api/src/services/search/hybridStrategy.ts`

Runs a configurable list of `SearchStrategy` instances in parallel and merges results using
Reciprocal Rank Fusion.

RRF score for a result `d` across `n` result lists:
```
RRF(d) = Σ  1 / (k + rank_i(d))    where k = 60 (default)
         i=1..n
```
Results absent from a list get rank `∞` (score contribution = 0).

Configuration (passed via `SearchQuery.options`):
| Key | Default | Notes |
|---|---|---|
| `rrf_k` | `60` | Tune between 10–100 for different corpus sizes |
| `topK` | `10` | Per-strategy fetch count before fusion |
| `fusedTopK` | `8` | Final result count after fusion |

Default strategy list: `[BM25Strategy, VectorStrategy]`.

`supports()`: returns `true` for `'hybrid'`.

---

### Task 1.6 — Strategy registry
**New file:** `apps/api/src/services/search/registry.ts`

A registry that maps each `QueryType` to a singleton module instance:

```typescript
const registry: Partial<Record<QueryType, SearchStrategy>> = {
  vector:         new VectorStrategy(),
  semantic_search: new VectorStrategy(),
  bm25:           new BM25Strategy(),
  hybrid:         new HybridStrategy([new BM25Strategy(), new VectorStrategy()]),
  // rag, csv, knowledge_graph: added in Phase 2, 3, 4
};

export function resolveStrategy(mode: QueryType): SearchStrategy | null {
  return registry[mode] ?? null;
}
```

`list_then_summarize` is intentionally excluded — it remains inline in `chat.ts` because it
fetches articles (not chunks) and has no `SearchResult` shape.

---

### Task 1.7 — Update queryUnderstanding.ts
**File:** `apps/api/src/services/queryUnderstanding.ts`

- Extend the Gemini structured-output schema's `retrieval_mode` enum to accept the new
  strategy names: `bm25`, `vector`, `hybrid`, `knowledge_graph`, `csv`, `rag`
- Update the fallback default: keep `semantic_search` as the safe default
- Update the Gemini prompt to describe when to select each new mode (e.g. `bm25` for
  keyword/code queries, `knowledge_graph` for entity-centric questions)
- Return type stays `QueryIntent`; only `retrieval_mode`'s valid values expand

---

### Task 1.8 — Refactor chat.ts
**File:** `apps/api/src/routes/chat.ts`

Replace the `if (retrieval_mode === 'list_then_summarize') { … } else { … }` block with:

```
if (retrieval_mode === 'list_then_summarize') {
  // unchanged — keep existing enumeration logic
} else {
  const strategy = resolveStrategy(retrieval_mode) ?? resolveStrategy('vector');
  const results = await strategy.search({
    text:        searchQuery,
    workspaceId: workspaceId,
    articleId:   articleId,
    filters:     { workspaceId, ...filters },
    topK:        TOP_K,
  });
  // assemble context from results (same grouping logic as before)
}
```

The `articleId` single-article fallback (lines 169–177 in current `chat.ts`) stays in place.

**Verification:** After this task, the chat endpoint must return identical responses to the
current behaviour for `semantic_search` and `hybrid` queries. Test manually via:
```
POST /workspaces/:id/chat  { "query": "summarize RAG" }
POST /workspaces/:id/chat  { "query": "what did I read last week about Python?" }
```

---

## Phase 2 — RAG Composer

**Goal:** Formalise the retrieve → assemble → generate pipeline as a composable module so
any retriever can be swapped in without touching generation logic.

### Task 2.1 — RAG strategy
**New file:** `apps/api/src/services/search/ragStrategy.ts`

`RagStrategy` wraps a `retriever: SearchStrategy` and exposes the full pipeline:

1. `retriever.search(query)` → `SearchResult[]`
2. Assemble context block (respecting `MAX_CONTEXT_CHARS = 6000`, grouped by article)
3. Call `buildChatStream(query.text, context, history, sources, contextHint)` from
   `apps/api/src/services/chatService.ts`
4. Return a streaming generator identical to the current SSE stream

`RagStrategy` does not implement the `SearchStrategy` interface directly (its output is a
stream, not `SearchResult[]`). It is a composer invoked directly from `chat.ts` when the
route needs a full generate pass.

`supports()`: returns `true` for `'rag'`.

### Task 2.2 — Wire RAG in chat.ts
**File:** `apps/api/src/routes/chat.ts`

When `retrieval_mode === 'rag'`:
- Resolve inner retriever from a `rag_retriever` option or default to `HybridStrategy`
- Hand off to `RagStrategy` for the full pipeline

---

## Phase 3 — CSV Module

**Goal:** Let users upload a CSV and search its rows via structured column filters + BM25
on free-text columns.

### Task 3.1 — Schema + migration
**New migration:** `apps/api/src/db/migrations/0004_csv_tables.sql`

```sql
CREATE TABLE csv_uploads (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  filename      text NOT NULL,
  column_schema jsonb NOT NULL,  -- array of { name, type: 'text'|'numeric'|'date'|'boolean' }
  row_count     integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE csv_rows (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id   uuid NOT NULL REFERENCES csv_uploads(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL,
  row_index   integer NOT NULL,
  metadata    jsonb NOT NULL,   -- typed column values
  content     text NOT NULL,    -- concatenated free-text column values for BM25
  search_vector tsvector
    GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX csv_rows_upload_idx       ON csv_rows(upload_id);
CREATE INDEX csv_rows_workspace_idx    ON csv_rows(workspace_id);
CREATE INDEX csv_rows_search_vec_idx   ON csv_rows USING GIN(search_vector);
CREATE INDEX csv_rows_metadata_idx     ON csv_rows USING GIN(metadata);
```

**File:** `apps/api/src/db/schema.ts` — add `csvUploads` and `csvRows` table definitions.

### Task 3.2 — CSV strategy
**New file:** `apps/api/src/services/search/csvStrategy.ts`

Query flow:
1. Parse `query.text` for column-value patterns (`status = done`, `price > 100`)
2. Translate to JSONB containment / range predicates on `metadata`
3. Run BM25 against `csv_rows.search_vector` for unstructured remainder of query
4. Merge: exact column matches (score = 1.0) rank above BM25 text matches
5. Apply `workspaceId` and date filters via `buildMetadataWhere` on `created_at`

`supports()`: returns `true` for `'csv'` or when `filters.sourceType === 'csv'`.

### Task 3.3 — CSV upload route
**New file:** `apps/api/src/routes/csv.ts`

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/workspaces/:wid/csv/upload` | Multipart upload, schema inference, row materialisation |
| `GET` | `/workspaces/:wid/csv` | List uploads (id, filename, row_count, created_at) |
| `DELETE` | `/workspaces/:wid/csv/:id` | Delete upload + all rows |

Upload handler steps:
1. Receive multipart `file` field (max 10 MB)
2. Parse first row as header; infer column types by sampling first 50 rows
3. Insert `csv_uploads` record
4. Stream remaining rows into `csv_rows` in batches of 500
5. Return `{ id, filename, rowCount, columnSchema }`

### Task 3.4 — Register CSV strategy + queryUnderstanding
- Add `CsvStrategy` to `registry.ts`
- Add `'csv'` detection heuristic to `queryUnderstanding.ts` prompt
- Register the CSV upload route in `apps/api/src/app.ts`

---

## Phase 4 — Knowledge Graph Module

**Goal:** Entity-centric search. At ingest, extract entity–relation triples from each article
using Gemini. At query time, traverse the graph to surface related articles.

### Task 4.1 — Schema + migration
**New migration:** `apps/api/src/db/migrations/0005_knowledge_graph.sql`

```sql
CREATE TYPE entity_type AS ENUM
  ('person', 'organisation', 'location', 'concept', 'technology', 'other');

CREATE TABLE entities (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  canonical_name text NOT NULL,
  type           entity_type NOT NULL DEFAULT 'other',
  aliases        jsonb NOT NULL DEFAULT '[]',  -- array of known name variants
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, canonical_name)
);

CREATE TABLE triples (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL,
  subject_entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  predicate         text NOT NULL,
  object_entity_id  uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  source_article_id uuid REFERENCES articles(id) ON DELETE SET NULL
);

CREATE TABLE article_entities (
  article_id    uuid NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  entity_id     uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  mention_count integer NOT NULL DEFAULT 1,
  PRIMARY KEY (article_id, entity_id)
);

CREATE INDEX entities_workspace_idx       ON entities(workspace_id);
CREATE INDEX entities_canonical_name_idx  ON entities(workspace_id, canonical_name);
CREATE INDEX entities_aliases_idx         ON entities USING GIN(aliases);
CREATE INDEX triples_subject_idx          ON triples(subject_entity_id);
CREATE INDEX triples_object_idx           ON triples(object_entity_id);
CREATE INDEX article_entities_entity_idx  ON article_entities(entity_id);
```

**File:** `apps/api/src/db/schema.ts` — add `entities`, `triples`, `articleEntities` table
definitions and `entityTypeEnum`.

### Task 4.2 — Entity extraction service
**New file:** `apps/api/src/services/entityExtractor.ts`

Exports `extractEntities(articleId: string): Promise<void>`:

1. Load article `markdownContent` from DB
2. Send to Gemini with a structured-output prompt requesting an array of triples:
   ```
   { subject, subject_type, predicate, object, object_type }[]
   ```
3. Upsert entities by `canonical_name` within the workspace (deduplication)
4. Insert `triples` linking subject → object via predicate
5. Insert / update `article_entities` mention counts

Gemini call: `gemini-2.0-flash-lite` with `responseSchema` (same pattern as
`queryUnderstanding.ts`). Model, API key, and client reused from `apps/api/src/services/llm.ts`.

### Task 4.3 — Knowledge Graph strategy
**New file:** `apps/api/src/services/search/knowledgeGraphStrategy.ts`

Query flow:
1. Send `query.text` to Gemini for NER — returns `{ entities: string[] }`
2. Resolve each mention to entity IDs via exact + alias match in the `entities` table
3. 1-hop: `SELECT DISTINCT article_id FROM article_entities WHERE entity_id IN ($ids)`
4. Optional 2-hop: expand entity IDs via `triples`, repeat step 3
5. Score: direct match = 1.0 · 1-hop neighbour = 0.6 · 2-hop neighbour = 0.3; break ties
   by `articles.created_at DESC`
6. Apply `MetadataFilter` via `buildMetadataWhere`
7. Return top-K `SearchResult[]` with `articleId` set and `content` = article title + overview

`supports()`: returns `true` for `'knowledge_graph'`.

### Task 4.4 — Entity extraction BullMQ worker
**File:** `apps/api/src/workers/queue.ts` — add `entity_extraction` queue.

**New file:** `apps/api/src/workers/entityExtractionWorker.ts`

Processes `entity_extraction` jobs: calls `extractEntities(articleId)`. Job is enqueued at
the end of `chunkingWorker.ts` after chunking completes, so the extraction runs async after
the article is ready.

### Task 4.5 — Register KG strategy + queryUnderstanding
- Add `KnowledgeGraphStrategy` to `registry.ts`
- Update `queryUnderstanding.ts` Gemini prompt with `knowledge_graph` detection heuristics
  (entity-centric queries: "who wrote", "articles mentioning", "related to person X")

---

## Phase 5 — Full Metadata Column Expansion (Future)

**Goal:** Enable the full `MetadataFilter` spec: `sourceType`, `domain`, `language`, `tags`,
`readingTimeMin/Max`.

### Task 5.1 — Migration: add article metadata columns
**New migration:** `apps/api/src/db/migrations/0006_article_metadata.sql`

```sql
ALTER TABLE articles
  ADD COLUMN source_type   text,                        -- 'url' | 'pdf' | 'paste' | 'csv'
  ADD COLUMN domain        text,                        -- extracted hostname
  ADD COLUMN language      text,                        -- BCP 47 (e.g. 'en', 'es')
  ADD COLUMN tags          text[] NOT NULL DEFAULT '{}',
  ADD COLUMN reading_time_seconds integer;

CREATE INDEX articles_domain_idx    ON articles(workspace_id, domain);
CREATE INDEX articles_tags_idx      ON articles USING GIN(tags);
CREATE INDEX articles_language_idx  ON articles(workspace_id, language);
```

### Task 5.2 — Update MetadataFilter utility
**File:** `apps/api/src/services/search/metadataFilter.ts`

Extend `buildMetadataWhere` to handle the new fields. Tags use `@>` (array containment with
OR semantics — expand to `tags && $tags`). Domain is an exact match. Reading time uses range
predicates.

### Task 5.3 — Populate at ingest
**File:** `apps/api/src/services/extractor.ts`

- Derive `domain` from `source_url` via `new URL(sourceUrl).hostname`
- Detect `source_type` from the ingestion route (`'url'`, `'pdf'`, `'paste'`)
- Derive `reading_time_seconds` from `word_count` at ~200 wpm
- `language` detection: optional — use `franc` package or defer to Gemini during extraction

**File:** `apps/api/src/db/schema.ts` — add new columns to `articles` Drizzle definition.

---

## File Map

```
packages/shared/src/
└── index.ts                                    ← Task 1.1 (extend types)

apps/api/src/
├── db/
│   ├── schema.ts                               ← Tasks 1.4b, 3.1, 4.1, 5.1
│   └── migrations/
│       ├── 0003_bm25_tsvector.sql              ← Task 1.4a
│       ├── 0004_csv_tables.sql                 ← Task 3.1
│       ├── 0005_knowledge_graph.sql            ← Task 4.1
│       └── 0006_article_metadata.sql           ← Task 5.1
├── services/
│   ├── search/
│   │   ├── metadataFilter.ts                   ← Task 1.2
│   │   ├── vectorStrategy.ts                   ← Task 1.3
│   │   ├── bm25Strategy.ts                     ← Task 1.4c
│   │   ├── hybridStrategy.ts                   ← Task 1.5
│   │   ├── registry.ts                         ← Task 1.6
│   │   ├── ragStrategy.ts                      ← Task 2.1
│   │   ├── csvStrategy.ts                      ← Task 3.2
│   │   └── knowledgeGraphStrategy.ts           ← Task 4.3
│   ├── entityExtractor.ts                      ← Task 4.2
│   ├── extractor.ts                            ← Task 5.3 (add domain/language/readingTime)
│   └── queryUnderstanding.ts                   ← Tasks 1.7, 3.4, 4.5
├── routes/
│   ├── chat.ts                                 ← Tasks 1.8, 2.2
│   └── csv.ts                                  ← Task 3.3
└── workers/
    ├── queue.ts                                ← Task 4.4
    ├── chunkingWorker.ts                       ← Task 4.4 (enqueue entity extraction)
    └── entityExtractionWorker.ts               ← Task 4.4
```

---

## Verification Checkpoints

After each phase, verify manually via `docker compose up` + curl or the web UI.

| After | Check |
|---|---|
| Phase 1 | `POST /chat { "query": "explain RAG" }` returns the same answer as before |
| Phase 1 | `POST /chat { "query": "Python articles from last week" }` returns same date-filtered result |
| Phase 1 | `POST /chat { "query": "\"vector database\" performance" }` uses BM25 (check logs) |
| Phase 2 | `POST /chat { "query": "explain what I read about embeddings" }` triggers RAG path |
| Phase 3 | `POST /csv/upload` with a sample CSV; then `POST /chat { "query": "rows where status = done" }` |
| Phase 4 | Add article; check `entities` + `article_entities` tables populated; `POST /chat { "query": "articles mentioning OpenAI" }` returns entity-matched results |
| Phase 5 | `POST /chat { "query": "arxiv.org articles" }` filters by domain |
