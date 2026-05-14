# Algorithm Plan — CSV Strategy

**Phase:** 3  
**Status:** Planning  
**Spec:** [search-algorithms.md](../tech-specs/dev-features/search-algorithms.md#module-5--csv)  
**Phasewise plan:** [search-algorithms-implementation-plan.md](./search-algorithms-implementation-plan.md) — Tasks 3.1–3.4

---

## What it does

Lets users upload a CSV file and search its rows. Columns with structured values (numbers,
dates, booleans) become filterable metadata fields. Free-text columns become BM25-searchable
content. Exact column-value matches rank above text matches.

---

## Prerequisites

- Phase 1 complete: all shared types, `buildMetadataWhere`, and the registry
- `BM25Strategy` complete — CSV reuses the same `tsvector`/`ts_rank_cd` pattern on the
  `csv_rows.search_vector` column
- `apps/api/src/app.ts` is where the new CSV route will be registered

---

## Tasks

### Task C-1 — Database migration
**New file:** `apps/api/src/db/migrations/0004_csv_tables.sql`

Create two tables:

**`csv_uploads`** — one row per uploaded file  
Columns: `id`, `workspace_id` (FK → workspaces), `filename`, `column_schema` (JSONB array of
`{ name, type }` objects), `row_count`, `created_at`.

**`csv_rows`** — one row per CSV data row  
Columns: `id`, `upload_id` (FK → csv_uploads), `workspace_id`, `row_index`, `metadata`
(JSONB — typed column values), `content` (text — concatenated free-text column values),
`search_vector` (tsvector generated from `content`, STORED), `created_at`.

Indexes needed:
- `csv_rows(upload_id)`
- `csv_rows(workspace_id)`
- GIN on `csv_rows.search_vector`
- GIN on `csv_rows.metadata` (for JSONB key/value queries)

### Task C-2 — Drizzle schema update
**File:** `apps/api/src/db/schema.ts`

Add `csvUploads` and `csvRows` table definitions. The `search_vector` column on `csv_rows`
uses the same `tsvector` customType introduced for `article_chunks` in the BM25 migration.

### Task C-3 — Create csvStrategy.ts
**New file:** `apps/api/src/services/search/csvStrategy.ts`

**Column-value parsing**  
Parse `query.text` for patterns like `field = value`, `field > value`, `field contains value`.
Translate each matched condition into a JSONB predicate against `csv_rows.metadata`:
- Equality: `metadata @> '{"field": "value"}'`
- Numeric range: compare cast values
- For unrecognised patterns, pass the full query text to the BM25 path

**Result ranking**  
Two-tier scoring:
- Rows matching a structured column predicate: score = 1.0
- Rows matching only the BM25 free-text search: score = ts_rank_cd result normalised to
  [0, 0.9] to stay below exact column matches

**Workspace and upload scoping**  
Always filter by `workspace_id`. Optionally filter by `upload_id` if provided in
`SearchQuery.options.upload_id`.

**Metadata filter**  
Apply date filter via `buildMetadataWhere` on `csv_rows.created_at` (which reflects upload
time, not row origin date).

Return `SearchResult[]` where `content` is the row's concatenated free-text fields and
`metadata` carries the parsed column values.

- `name`: `'csv'`
- `supports()`: true for `'csv'`
- `score()`: identity

### Task C-4 — Create csv.ts route
**New file:** `apps/api/src/routes/csv.ts`

Three endpoints, all workspace-scoped:

**`POST /workspaces/:wid/csv/upload`** — multipart form upload (field name: `file`, max 10 MB)

Steps:
1. Receive file buffer
2. Parse first row as column headers
3. Infer column types by sampling the first 50 data rows using these heuristics:
   - All values parse as integer → `numeric`
   - All values parse as float → `numeric`
   - All values match ISO 8601 or common date formats → `date`
   - All values are `true`/`false`/`yes`/`no`/`1`/`0` → `boolean`
   - Anything else → `text`
4. Insert `csv_uploads` record with inferred `column_schema`
5. Insert rows into `csv_rows` in batches of 500:
   - `metadata` JSONB: typed column values keyed by column name
   - `content` text: concatenate all `text`-typed column values, space-separated
6. Update `csv_uploads.row_count`
7. Return `{ id, filename, rowCount, columnSchema }`

**`GET /workspaces/:wid/csv`** — list uploads  
Returns `[{ id, filename, rowCount, createdAt }]` ordered by `created_at DESC`.

**`DELETE /workspaces/:wid/csv/:id`** — delete upload  
Cascading delete via FK removes all associated `csv_rows`.

### Task C-5 — Register CSV strategy + wire app.ts
**File:** `apps/api/src/services/search/registry.ts` — add `CsvStrategy` under `'csv'`.

**File:** `apps/api/src/services/queryUnderstanding.ts` — add `'csv'` to the
`retrieval_mode` enum and add a prompt heuristic: select `csv` when the query references
rows, columns, spreadsheet data, or filtered tabular values.

**File:** `apps/api/src/app.ts` — register `csvRouter` on the workspace-scoped router.

---

## Files touched

| File | Change type |
|---|---|
| `apps/api/src/db/migrations/0004_csv_tables.sql` | New |
| `apps/api/src/db/schema.ts` | Modify — add csvUploads, csvRows table definitions |
| `apps/api/src/services/search/csvStrategy.ts` | New |
| `apps/api/src/routes/csv.ts` | New |
| `apps/api/src/services/search/registry.ts` | Modify — register CsvStrategy |
| `apps/api/src/services/queryUnderstanding.ts` | Modify — add `'csv'` to enum + prompt |
| `apps/api/src/app.ts` | Modify — mount csvRouter |

---

## Verification

1. Run the migration; confirm both tables and all indexes exist via `\d csv_rows`
2. Upload a sample CSV (e.g. a task list with columns: `title`, `status`, `priority`, `due_date`)
3. `GET /workspaces/:id/csv` → confirm upload appears in list with correct `rowCount`
4. `POST /workspaces/:id/chat { "query": "rows where status = done" }` → returns rows where
   the `status` column equals "done"
5. `POST /workspaces/:id/chat { "query": "high priority tasks" }` → BM25 path triggers on
   free-text content
6. `DELETE /workspaces/:id/csv/:uploadId` → rows and upload record are removed

---

## Risks

- Column type inference from 50 rows may misclassify sparse columns (e.g. a numeric column
  that has a few empty cells). Treat empty/null cells as the column's type is determined by
  non-null values.
- The `websearch_to_tsquery` path for the BM25 portion of CSV search may return null for
  all-stop-word queries — handle with an empty result rather than an error.
- Large CSVs (>100k rows) should be processed asynchronously via BullMQ. The current plan
  is synchronous (in-request). Flag this in `techdebt.md` after implementation.
