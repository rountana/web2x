# Algorithm Plan — Knowledge Graph Strategy

**Phase:** 4  
**Status:** Planning  
**Spec:** [search-algorithms.md](../tech-specs/dev-features/search-algorithms.md#module-7--knowledge-graph)  
**Phasewise plan:** [search-algorithms-implementation-plan.md](./search-algorithms-implementation-plan.md) — Tasks 4.1–4.5

---

## What it does

Entity-centric search. At article ingest time, Gemini extracts entity–relation triples from
the article content and stores them in a graph schema. At query time, the user's query is
parsed for entity mentions, matched against the graph, and articles linked to those entities
are returned — including multi-hop neighbours.

---

## Prerequisites

- Phase 1 complete: shared types, registry, `buildMetadataWhere`
- Phase 2 complete: `RagStrategy` (Knowledge Graph results can be passed to RAG as a
  retriever, so RAG must be available before this phase completes)
- `apps/api/src/services/llm.ts` — Gemini client and API key already configured; entity
  extraction will reuse the same pattern as `queryUnderstanding.ts`
- BullMQ infrastructure already in place (`apps/api/src/workers/`)

---

## Tasks

### Task K-1 — Database migration
**New file:** `apps/api/src/db/migrations/0005_knowledge_graph.sql`

**`entity_type` enum:** `person`, `organisation`, `location`, `concept`, `technology`, `other`

**`entities` table**  
Columns: `id`, `workspace_id` (FK → workspaces), `canonical_name`, `type`
(entity_type enum), `aliases` (JSONB array of alternate name strings), `created_at`.  
Unique constraint on `(workspace_id, canonical_name)` — prevents duplicate entity nodes
within a workspace.

**`triples` table**  
Columns: `id`, `workspace_id`, `subject_entity_id` (FK → entities), `predicate` (text),
`object_entity_id` (FK → entities), `source_article_id` (FK → articles, nullable,
SET NULL on delete).  
Represents a directed relationship: subject → predicate → object.

**`article_entities` table**  
Columns: `article_id` (FK → articles), `entity_id` (FK → entities), `mention_count`.  
Composite PK on `(article_id, entity_id)`.  
Links articles to the entities they mention.

Indexes needed:
- `entities(workspace_id)`
- `entities(workspace_id, canonical_name)` — for deduplication lookups
- GIN on `entities.aliases` — for fuzzy alias matching
- `triples(subject_entity_id)` and `triples(object_entity_id)` — for graph traversal
- `article_entities(entity_id)` — for the 1-hop article lookup

### Task K-2 — Drizzle schema update
**File:** `apps/api/src/db/schema.ts`

Add `entityTypeEnum`, `entities`, `triples`, and `articleEntities` table definitions using
Drizzle ORM. Use `pgEnum` for `entity_type`. Map `aliases` as `jsonb().$type<string[]>()`.

### Task K-3 — Entity extraction service
**New file:** `apps/api/src/services/entityExtractor.ts`

Exports `extractEntities(articleId: string): Promise<void>`

Steps:
1. Load `markdownContent` and `workspaceId` for the article from the DB
2. Send content to Gemini (`gemini-2.0-flash-lite`) with a structured-output prompt
   requesting an array of triples: `{ subject, subject_type, predicate, object, object_type }`
   — same `responseSchema` pattern as `queryUnderstanding.ts`
3. For each unique entity name in the response:
   - Attempt `INSERT INTO entities … ON CONFLICT (workspace_id, canonical_name) DO NOTHING`
   - Collect the resolved entity IDs (both inserted and pre-existing)
4. Insert `triples` rows linking subject → predicate → object, with `source_article_id` set
5. Upsert `article_entities` — increment `mention_count` if the row already exists

**Deduplication strategy:** Canonical names are lowercased and trimmed before insert.
Alternate surface forms returned by Gemini (e.g. "Open AI" alongside "OpenAI") are appended
to the existing entity's `aliases` JSONB array via `jsonb_array_append` on conflict.

The service is intentionally synchronous within its own function boundary — parallelism is
provided by the BullMQ worker that calls it.

### Task K-4 — Knowledge Graph strategy
**New file:** `apps/api/src/services/search/knowledgeGraphStrategy.ts`

**Query phase:**

Step 1 — Entity extraction from query  
Send `query.text` to Gemini with a short NER prompt: "Extract all named entities from this
query. Return as JSON array of strings." Use `gemini-2.0-flash-lite`.

Step 2 — Entity resolution  
For each extracted entity name, query the `entities` table:
- Exact match on `canonical_name` (case-insensitive)
- Alias match: `aliases @> '["name"]'` (JSONB containment)
Collect matching entity IDs.

Step 3 — 1-hop article retrieval  
`SELECT DISTINCT article_id FROM article_entities WHERE entity_id IN ($ids)`. Join `articles`
for title and `created_at`. Apply `MetadataFilter` via `buildMetadataWhere`.

Step 4 — Optional 2-hop traversal  
Controlled by `SearchQuery.options.kg_hops` (default: 1; max: 2).  
Expand entity ID set via `triples`: collect all `object_entity_id` values where
`subject_entity_id IN ($ids)` and vice versa. Repeat step 3 for these expanded IDs.

Step 5 — Scoring  
- Direct entity match (step 3): score = 1.0
- 1-hop neighbour (step 4, first expansion): score = 0.6
- 2-hop neighbour: score = 0.3
- Tie-break by `articles.created_at DESC`

Step 6 — Return  
Top-K `SearchResult[]` where `content` = article title + summary overview (if available),
`articleId` set, `source: 'knowledge_graph'`.

- `name`: `'knowledge_graph'`
- `supports()`: true for `'knowledge_graph'`
- `score()`: identity

### Task K-5 — BullMQ entity extraction worker
**File:** `apps/api/src/workers/queue.ts`  
Add a new BullMQ queue: `entity_extraction`.

**New file:** `apps/api/src/workers/entityExtractionWorker.ts`  
Processes jobs with payload `{ articleId: string }`. Calls `extractEntities(articleId)`.
On failure, logs the error and does not retry (entity extraction is best-effort; the article
is still usable without graph data).

**File:** `apps/api/src/workers/chunkingWorker.ts`  
After a chunking job completes successfully, enqueue an `entity_extraction` job with the same
`articleId`. This keeps the extraction async and non-blocking for the article's ready state.

### Task K-6 — Register KG strategy + queryUnderstanding
**File:** `apps/api/src/services/search/registry.ts`  
Add `KnowledgeGraphStrategy` under `'knowledge_graph'`.

**File:** `apps/api/src/services/queryUnderstanding.ts`  
Add `'knowledge_graph'` to the `retrieval_mode` enum and update the Gemini prompt to select
it for entity-centric queries:
- "articles mentioning [person/org/place]"
- "who wrote about X"
- "what is [person]'s connection to [concept]"
- "articles related to [company]"

---

## Files touched

| File | Change type |
|---|---|
| `apps/api/src/db/migrations/0005_knowledge_graph.sql` | New |
| `apps/api/src/db/schema.ts` | Modify — add entities, triples, articleEntities, entityTypeEnum |
| `apps/api/src/services/entityExtractor.ts` | New |
| `apps/api/src/services/search/knowledgeGraphStrategy.ts` | New |
| `apps/api/src/workers/entityExtractionWorker.ts` | New |
| `apps/api/src/workers/queue.ts` | Modify — add entity_extraction queue |
| `apps/api/src/workers/chunkingWorker.ts` | Modify — enqueue entity_extraction after chunking |
| `apps/api/src/services/search/registry.ts` | Modify — register KnowledgeGraphStrategy |
| `apps/api/src/services/queryUnderstanding.ts` | Modify — add `'knowledge_graph'` to enum + prompt |

---

## Verification

1. Ingest a new article; wait for chunking to complete; confirm `entity_extraction` job
   appears in BullMQ dashboard and completes
2. Query `SELECT * FROM entities WHERE workspace_id = '...'` — confirm entities were
   extracted and deduplicated
3. Query `SELECT * FROM article_entities` — confirm article is linked to its entities
4. `POST /workspaces/:id/chat { "query": "articles mentioning OpenAI" }` → returns articles
   where OpenAI appears as an entity
5. `POST /workspaces/:id/chat { "query": "articles related to Sam Altman" }` → 2-hop
   traversal finds articles connected via organisation relationships

---

## Risks

- Entity extraction adds 1–2 Gemini API calls per article at ingest time. This is deferred
  to the BullMQ worker to avoid slowing down article readiness. If the Gemini quota is
  exhausted, log and skip — the article is unaffected.
- Canonical name deduplication is case-insensitive but not fuzzy. "Sam Altman" and "S. Altman"
  will be separate entities. This is a known limitation; flagged in `techdebt.md`.
- The 2-hop query involves two separate DB round trips. For large corpora this should be
  rewritten as a single recursive CTE. Flagged in `techdebt.md`.
- The Gemini NER call at query time adds ~200–400 ms latency to every Knowledge Graph query.
  Consider caching entity lists for repeated queries in the same session.
