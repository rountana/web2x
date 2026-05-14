# Algorithm Plan — BM25 Strategy

**Phase:** 1 (Core Retrieval Contract)  
**Status:** Planning  
**Spec:** [search-algorithms.md](../tech-specs/dev-features/search-algorithms.md#module-1--bm25)  
**Phasewise plan:** [search-algorithms-implementation-plan.md](./search-algorithms-implementation-plan.md) — Task 1.4

---

## What it does

Keyword-based full-text search over article chunks using PostgreSQL's native full-text search
engine. Scores results using `ts_rank_cd`, which approximates the Okapi BM25 ranking formula.
Best for queries containing exact terms, proper nouns, code identifiers, or quoted phrases
where semantic similarity would paraphrase over the match.

---

## Prerequisites

- Task 1.1 complete: shared types in `packages/shared/src/index.ts`
- Task 1.2 complete: `buildMetadataWhere` in `apps/api/src/services/search/metadataFilter.ts`
- No other strategy modules are required — BM25 runs independently against the DB

---

## Tasks

### Task B-1 — Database migration
**New file:** `apps/api/src/db/migrations/0003_bm25_tsvector.sql`

Add a `tsvector` generated column to `article_chunks`:
- Column name: `search_vector`
- Generated automatically from `content` using `to_tsvector('english', content)`
- Marked `GENERATED ALWAYS AS … STORED` so PostgreSQL maintains it on every insert and
  update — no application-level trigger needed
- Add a GIN index on `search_vector` for fast `@@` operator lookups

This migration also implicitly backfills all existing rows because `STORED` generated columns
are populated at `ALTER TABLE` time.

### Task B-2 — Drizzle schema update
**File:** `apps/api/src/db/schema.ts`

Add `searchVector` to the `articleChunks` table definition:
- Use a `customType` for the `tsvector` PostgreSQL type (same pattern as the existing
  `vector` customType in this file)
- Mark it as a generated column with `.generatedAlwaysAs()`
- The column is read-only from the application's perspective — Drizzle should not include it
  in `INSERT` statements

### Task B-3 — Create bm25Strategy.ts
**New file:** `apps/api/src/services/search/bm25Strategy.ts`

The module must:
- Accept a `SearchQuery` and sanitise `query.text` to prevent `tsquery` syntax errors
  (use `websearch_to_tsquery` rather than `to_tsquery` — it handles user input safely
  without requiring manual escaping)
- Execute a ranked full-text search:
  - Match chunks where `search_vector @@ query`
  - Join `articles` for workspace scoping and title
  - Apply `MetadataFilter` via `buildMetadataWhere`
  - Order by `ts_rank_cd(search_vector, query) DESC`
  - Limit to `query.topK` (default 8)
- Normalise `ts_rank_cd` scores to `[0, 1]` by dividing each result's rank by the maximum
  rank in the result set. If only one result, score = 1.0.
- Return `SearchResult[]` with `source: 'bm25'`
- `name`: `'bm25'`
- `supports()`: true for `'bm25'`
- `score()`: identity — scores set during search

**Note on ranking accuracy:** `ts_rank_cd` is PostgreSQL's built-in ranker and is a close
approximation of BM25 but not identical. The `pg_bm25` extension provides true Okapi BM25
scoring but requires an additional PostgreSQL extension. This is flagged in `techdebt.md` as
the production upgrade path; the current implementation uses only built-in capabilities.

### Task B-4 — Register in registry.ts
**File:** `apps/api/src/services/search/registry.ts`

Add `BM25Strategy` under the `'bm25'` key.

### Task B-5 — Update queryUnderstanding.ts
**File:** `apps/api/src/services/queryUnderstanding.ts`

Add `'bm25'` as a valid value in the Gemini structured-output schema's `retrieval_mode` enum.
Update the Gemini prompt to include a description of when to select `bm25`:
- Queries with quoted exact phrases
- Code identifiers or technical tokens
- Proper nouns unlikely to appear paraphrased in the corpus
- Short, high-specificity keyword queries

---

## Files touched

| File | Change type |
|---|---|
| `apps/api/src/db/migrations/0003_bm25_tsvector.sql` | New |
| `apps/api/src/db/schema.ts` | Modify — add `searchVector` generated column to `articleChunks` |
| `apps/api/src/services/search/bm25Strategy.ts` | New |
| `apps/api/src/services/search/registry.ts` | Modify — register BM25Strategy |
| `apps/api/src/services/queryUnderstanding.ts` | Modify — add `'bm25'` to enum + prompt |

---

## Verification

- Run the migration: `docker compose exec db psql -c "\d article_chunks"` — confirm
  `search_vector` column and GIN index are present
- `POST /workspaces/:id/chat { "query": "\"pgvector\" HNSW index" }` — query intent should
  classify as `bm25`; response should cite chunks containing those exact terms
- `POST /workspaces/:id/chat { "query": "some keyword that doesn't exist" }` — BM25 returns
  empty array; chat should degrade gracefully (no 500)

---

## Risks

- The migration backfill is instant for small corpora; for large corpora it may lock the
  table briefly. Document this in the migration file.
- If `websearch_to_tsquery` returns a null query (e.g. all stop words), the `@@` operator
  returns zero rows — the module must handle this without crashing.
