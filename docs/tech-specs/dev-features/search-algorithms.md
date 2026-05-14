# Search Algorithms — Design Spec

**Status:** Design  
**Last updated:** 2026-05-02

---

## Overview

This document specifies seven modular search strategies for web2x. Each strategy is a
self-contained module that satisfies a shared `SearchStrategy` contract. Modules can be used
individually, composed in a pipeline, or fused together — without modifying one another.

This extends the three-mode retrieval system documented in
[`../search-architecture.md`](../search-architecture.md) (semantic_search,
list_then_summarize, hybrid). The modules below are a formalization and expansion of that system
into production-ready building blocks.

---

## Shared Interface Contract

All seven modules implement the same interface. This is the load-bearing design decision that
enables composition.

```
SearchQuery
  ├── text: string              — raw user input
  ├── workspaceId: string       — always-required scope boundary
  ├── filters?: MetadataFilter  — structured pre-filter (see Metadata module)
  ├── topK?: number             — max results (default: 8)
  └── options?: StrategyOptions — strategy-specific knobs (e.g. rrf_k, chunkOverlap)

SearchResult
  ├── id: string                — unique result identifier (chunk or article)
  ├── articleId: string
  ├── score: number             — normalised to [0, 1]
  ├── content: string           — snippet or full chunk
  ├── metadata: Record<string, unknown>
  └── source: StrategyName      — which module produced this result

SearchStrategy
  ├── name: StrategyName
  ├── search(query: SearchQuery): Promise<SearchResult[]>
  ├── score(result: SearchResult): number
  └── supports(queryType: QueryType): boolean
```

`QueryType` is an extension of the existing `RetrievalMode`
(`packages/shared/src/index.ts`) to include the new strategy names:
`bm25 | metadata | vector | rag | csv | hybrid | knowledge_graph`.

`supports()` allows the `queryUnderstanding` layer to select strategies at runtime based on
the query classification returned by Gemini — no hardcoded if/else chains.

---

## Module 1 — BM25

**Icon:** Hash

### Purpose
Exact-term recall. Best when the user's query contains specific keywords, proper nouns, code
identifiers, or rare terms that semantic models may paraphrase over.

### Module Contract
- **Input:** `SearchQuery.text` (tokenised into terms)
- **Output:** Ranked `SearchResult[]` sorted by BM25 score descending
- **`supports()`:** `queryType === 'bm25'` or when query contains quoted strings, code tokens,
  or signals high lexical specificity

### How It Works
Okapi BM25 is a probabilistic ranking function that scores documents by:

1. **Term Frequency (TF)** — how often query terms appear in a document, with saturation to
   prevent runaway score inflation from repeated terms
2. **Inverse Document Frequency (IDF)** — terms rare across the corpus score higher
3. **Document length normalisation** — shorter documents are not artificially penalised

Score formula per term `t` in document `d`:

```
BM25(t, d) = IDF(t) × [ TF(t,d) × (k1 + 1) ] / [ TF(t,d) + k1 × (1 - b + b × |d| / avgdl) ]
```

Default constants: `k1 = 1.2`, `b = 0.75`.

### Data & Index Requirements
- A `tsvector` column on the content table, populated at ingest time from the chunk's
  `content` field
- A GIN index on that column for fast phrase and term lookup
- Alternatively: the `pg_bm25` PostgreSQL extension, which exposes Okapi BM25 scoring natively
  rather than relying on `ts_rank`'s approximation

### Query Flow
1. Tokenise `SearchQuery.text` (strip stop words, apply stemming/lemmatisation)
2. Build a `tsquery` expression from the resulting tokens
3. Execute a ranked full-text search against the GIN index, filtered to `workspaceId`
4. Apply `MetadataFilter` if present (see Metadata module)
5. Return top-K results with normalised BM25 scores

### Composition Notes
- BM25 is a natural input to the **Hybrid** fusion module alongside Vector
- Can be wrapped by **RAG** as its inner retriever for keyword-grounded generation
- **Metadata** always runs as a pre-filter applied inside step 4

### Tradeoffs / Limitations
- Fails on paraphrase: "machine learning" will not match a chunk that says "deep learning" or
  "neural networks" unless the query explicitly lists those terms
- Sensitive to query length: very short queries (one word) produce noisy rankings
- IDF is corpus-relative — a rare term in a small personal corpus behaves differently than in a
  large one

---

## Module 2 — Metadata

**Icon:** Filter

### Purpose
Constrain the result set using structured document attributes before any ranking runs. Metadata
is not a standalone ranking module — it is a **pre-filter layer** that all other modules can
attach to via `SearchQuery.filters`.

### Module Contract
- **Input:** `SearchQuery.filters` (a `MetadataFilter` object)
- **Output:** A SQL predicate fragment applied inside the calling module's query
- **`supports()`:** Always returns `true`; metadata filtering is available to every strategy

### Filter Schema

```
MetadataFilter
  ├── sourceType?: 'url' | 'pdf' | 'paste' | 'csv'
  ├── tags?: string[]           — match any (OR semantics)
  ├── domain?: string           — exact hostname match (e.g. "arxiv.org")
  ├── language?: string         — BCP 47 language tag (e.g. "en", "es")
  ├── readingTimeMin?: number   — estimated reading time in seconds, lower bound
  ├── readingTimeMax?: number   — upper bound
  ├── dateFrom?: string         — ISO 8601, resolved from relative phrases by queryUnderstanding
  └── dateTo?: string           — ISO 8601
```

`dateFrom` / `dateTo` map directly to the existing `ChatFilters` type
(`packages/shared/src/index.ts`).

### How It Works
The filter is translated into parameterised SQL clauses and injected into the `WHERE` block of
the calling module's query. The translation layer is shared — each module calls a single
`buildMetadataWhere(filters)` utility that returns the clause and its parameter bindings.

### Query Flow
1. Receive `SearchQuery.filters`
2. Translate each present field into a SQL predicate
3. Return the predicate as a composable fragment — not a standalone query

### Composition Notes
- Every module that hits the database accepts `SearchQuery.filters` and passes it through
  `buildMetadataWhere`
- Metadata does not produce `SearchResult` objects of its own; it narrows the candidate set
  for the module that calls it

### Tradeoffs / Limitations
- Requires a well-normalised metadata schema; free-form tags stored as plaintext degrade filter
  precision
- Aggressive filtering on small corpora can reduce recall to zero — callers should surface a
  "no results after filtering" state distinctly from "no relevant results"

---

## Module 3 — Vector

**Icon:** Cpu

### Purpose
Semantic similarity search using dense vector embeddings. Best for conceptual questions,
paraphrase recall, and anything where the user's phrasing differs from the stored content.

### Module Contract
- **Input:** `SearchQuery.text` → embedded to a dense float vector
- **Output:** Ranked `SearchResult[]` sorted by cosine similarity descending
- **`supports()`:** `queryType === 'vector' || queryType === 'semantic_search'`

### How It Works
At ingest, each content chunk is passed to the local MLX embedding service
(`apps/api/src/services/mlxClient.ts`), which returns a fixed-dimension float vector stored in
a `pgvector` `vector` column. At query time:

1. The `reformulated_query` (temporal phrases stripped by `queryUnderstanding`) is embedded
   using the same MLX service
2. Cosine distance (`<=>` operator) is computed against all stored chunk vectors scoped to
   `workspaceId`
3. The approximate nearest-neighbour index returns top-K candidates

### Data & Index Requirements
- `vector(N)` column on the chunks table (N must match the MLX model's output dimension)
- HNSW index (`CREATE INDEX … USING hnsw (embedding vector_cosine_ops)`) for sub-linear ANN
  query time
- The MLX service must be available at ingest time and at query time; the existing
  `mlxClient.ts` satisfies both

### Query Flow
1. Send `reformulated_query` to MLX → receive embedding vector
2. Execute pgvector ANN query: top-K chunks by cosine distance, filtered to `workspaceId`
3. Apply `MetadataFilter` if present
4. Normalise distances to scores in [0, 1] (score = 1 − distance)
5. Return results

### Composition Notes
- Direct input to **Hybrid** (fused with BM25 results via RRF)
- Default inner retriever for **RAG**
- The existing `semantic_search` and `hybrid` modes in `search-architecture.md` are
  implemented by this module

### Tradeoffs / Limitations
- Embedding quality is bounded by the MLX model; domain-specific jargon may embed poorly
- HNSW recall is approximate; exact KNN is available but significantly slower at scale
- Cold start: chunks added before the embedding column existed must be backfilled

---

## Module 4 — RAG

**Icon:** Wand2

### Purpose
Grounded answer generation. RAG wraps any retriever module and adds a generate step —
the retrieved chunks become the context window for a Gemini call that produces a cited,
grounded answer.

### Module Contract
- **Input:** `SearchQuery` + a configured `retriever: SearchStrategy`
- **Output:** A structured `RAGResponse` (generated text + cited `SearchResult[]`)
- **`supports()`:** `queryType === 'rag'`; also used implicitly whenever the chat route
  needs a generated answer (not just ranked results)

### RAGResponse Shape

```
RAGResponse
  ├── answer: string            — Gemini-generated prose
  ├── citations: SearchResult[] — the chunks that grounded the answer
  └── retrievalMode: string     — which inner retriever was used
```

### How It Works

**Step 1 — Retrieve:** Delegate to the configured `retriever.search(query)` to get top-K
chunks. The retriever is pluggable: default is Vector, but BM25, Hybrid, or KnowledgeGraph
can be substituted without changing the RAG module.

**Step 2 — Chunk assembly:** Assemble retrieved chunks into a context block. Respect the
`MAX_CONTEXT_CHARS` ceiling (currently 6 000 chars as defined in `chat.ts`). Group chunks by
article to avoid interleaving unrelated passages.

**Step 3 — Optional re-rank:** Before assembly, a cross-encoder or LLM re-ranker can score
chunk relevance against the original query and reorder. This is an optional pass — the module
works without it; re-ranking improves precision at the cost of added latency.

**Step 4 — Augment:** Inject the assembled context into the Gemini system prompt using the
`context_hint` field from `QueryIntent`. The prompt instructs Gemini to cite article IDs for
every factual claim.

**Step 5 — Generate:** Stream the Gemini response back to the caller. Attach the citation
list derived from the chunk metadata to the `RAGResponse`.

### Chunk Window Parameters
| Parameter | Default | Notes |
|---|---|---|
| `chunkSize` | 512 tokens | Chunk size used at ingest time |
| `chunkOverlap` | 64 tokens | Overlap between adjacent chunks to preserve sentence context |
| `topK` | 8 | Retrieved before re-ranking |
| `postRerankK` | 5 | Chunks surviving the re-rank pass (if enabled) |

### Composition Notes
- RAG is a **composer**, not a peer: it always delegates retrieval to another module
- Swapping `retriever` changes the grounding source without modifying the generate logic
- The existing `buildChatStream` in `chatService.ts` implements steps 4–5; RAG formalises the
  contract so any retriever can feed it

### Tradeoffs / Limitations
- Adds Gemini API latency on top of retrieval latency
- Answer quality is bounded by retrieval quality — garbage in, garbage out
- Citation accuracy depends on the LLM; hallucinated citations are possible without explicit
  grounding constraints in the prompt
- Re-ranking adds ~200–400 ms; skip it for latency-sensitive paths

---

## Module 5 — CSV

**Icon:** Table2

### Purpose
Search over tabular data uploaded directly by the user. Each CSV is treated as a structured
document source where rows become searchable records and columns become filterable metadata fields.

### Module Contract
- **Input:** `SearchQuery` with `filters.sourceType === 'csv'`
- **Output:** Ranked `SearchResult[]` — rows matching the query
- **`supports()`:** `queryType === 'csv'` or `filters.sourceType === 'csv'`

### How It Works
CSV ingestion is a three-phase process:

**Phase 1 — Schema inference:** On upload, the first row (header) is parsed to extract column
names. Each column is classified by a heuristic into a type:
- Numeric (integer, float)
- Date / timestamp (ISO 8601, common locale formats)
- Boolean (true/false, yes/no, 1/0)
- Free text (everything else)

**Phase 2 — Row materialisation:** Each row is stored as a document. Numeric, date, and boolean
columns are stored as typed metadata fields. Free-text columns are stored as content eligible
for BM25 indexing.

**Phase 3 — Query execution:** At query time:
1. Parse the user query for column-value intent (e.g. "rows where status = done")
2. Translate matched conditions into SQL equality / range predicates on the metadata columns
3. Run BM25 against free-text columns for unstructured parts of the query
4. Merge and rank results (exact column matches score higher than text matches)

### Data Requirements
- A `csv_rows` table: `(id, upload_id, workspace_id, row_index, metadata JSONB, content text)`
- `upload_id` links to a `csv_uploads` table: `(id, workspace_id, filename, column_schema JSONB)`
- GIN index on `metadata` for JSONB key/value lookups; GIN index on `tsvector(content)` for
  BM25

### Composition Notes
- CSV results feed naturally into **RAG** — the generated answer can cite specific rows
- **Metadata** filters (`workspaceId`, `dateFrom`/`dateTo` on the upload timestamp) apply
  before the CSV query runs
- For CSVs with a free-text body column, **BM25** module logic is reused directly

### Tradeoffs / Limitations
- Schema inference can misclassify ambiguous columns (e.g. a "date" column with mixed formats)
- No joins across multiple CSVs in v1; each upload is queried independently
- Large CSVs (>100k rows) require pagination of results and async ingest

---

## Module 6 — Hybrid

**Icon:** Layers

### Purpose
Fuse results from two or more `SearchStrategy` modules into a single ranked list. The default
pairing is BM25 + Vector, which covers both lexical and semantic recall gaps.

### Module Contract
- **Input:** `SearchQuery` + a configured `strategies: SearchStrategy[]` (minimum 2)
- **Output:** Fused, re-ranked `SearchResult[]`
- **`supports()`:** `queryType === 'hybrid'`

### How It Works
Hybrid uses **Reciprocal Rank Fusion (RRF)** to merge result lists. RRF requires no trained
model and no score calibration across strategies — it operates purely on rank positions.

**RRF score for result `d` across strategy result lists `R`:**

```
RRF(d) = Σ  1 / (k + rank_i(d))
         i∈R
```

Where `k` is a constant (default: 60) that dampens the influence of very high-ranked results.
A document not present in a strategy's list is assigned rank `∞` (score contribution = 0).

**Fusion steps:**
1. Execute all configured strategies in parallel against the same `SearchQuery`
2. Collect each strategy's ranked result list
3. Compute RRF scores across all lists
4. Sort by RRF score descending; deduplicate by `result.id`
5. Return fused top-K results, annotating each with its contributing strategies

### Configuration
| Parameter | Default | Notes |
|---|---|---|
| `strategies` | `[BM25, Vector]` | Any `SearchStrategy[]`; order does not affect RRF |
| `rrf_k` | 60 | Higher values reduce dominance of top ranks; tune between 10–100 |
| `topK` | 10 | Collected from each strategy before fusion |
| `fusedTopK` | 8 | Final result count after fusion |

### Composition Notes
- Upgrade path from the existing `hybrid` mode (`search-architecture.md`), which does
  vector + date filter but does not do BM25 fusion
- Hybrid results can be passed to **RAG** as the retriever
- Any strategy, including **KnowledgeGraph** or **CSV**, can be added to the `strategies` list
- **Metadata** pre-filtering is applied inside each constituent strategy before fusion

### Tradeoffs / Limitations
- Parallel strategy execution increases DB load; strategies should share a connection pool
- RRF is position-insensitive to score magnitude — two results with very different relevance
  scores at the same rank are treated identically
- Adding more strategies beyond two often yields diminishing returns and increases latency

---

## Module 7 — Knowledge Graph

**Icon:** Network

### Purpose
Entity-centric search. Finds articles connected by shared entities (people, organisations,
concepts, locations) and traverses relationships between them — queries like "articles
related to the people mentioned in X" that pure text search cannot answer.

### Module Contract
- **Input:** `SearchQuery.text` parsed for entity mentions
- **Output:** Ranked `SearchResult[]` — articles surfaced via entity match or graph traversal
- **`supports()`:** `queryType === 'knowledge_graph'` or when entity-centric intent is detected
  by `queryUnderstanding`

### How It Works

**Ingest phase (at article save time):**
1. Send article content to Gemini with a structured-extraction prompt
2. Gemini returns a list of entity–relation triples: `(subject, predicate, object)` where each
   entity has a canonical name and a type (Person, Organisation, Location, Concept, Technology)
3. Store triples in a graph-adjacent schema (see Data Requirements)
4. Deduplicate entities by canonical name across articles to build a shared entity index

**Query phase:**
1. Parse the query for entity mentions (NER pass, or delegate to Gemini)
2. Look up matching entities in the entity index
3. Retrieve all articles linked to those entities (1-hop)
4. Optionally traverse one additional hop: find entities adjacent to the matched entity, then
   find their articles (2-hop)
5. Score results: direct entity match > 1-hop neighbour > 2-hop neighbour; break ties by
   article recency
6. Return top-K articles as `SearchResult[]`

### Data Requirements
Three tables form the graph:

```
entities        (id, canonical_name, type, aliases JSONB)
triples         (id, subject_entity_id, predicate, object_entity_id)
article_entities(article_id, entity_id, mention_count)
```

GIN indexes on `entities.aliases` and `entities.canonical_name` support fuzzy entity lookup.
The schema avoids a dedicated graph DB in v1 — PostgreSQL adjacency lists are sufficient for
corpora under ~1M entities. Apache AGE is the upgrade path for graph-native traversal queries.

### Query Flow
1. Extract entity mentions from `SearchQuery.text`
2. Resolve mentions to entity IDs via the entity index (exact + fuzzy alias match)
3. Join `article_entities` to find articles linked to those entity IDs
4. Optional 2-hop: join `triples` to find related entity IDs, repeat step 3
5. Apply `MetadataFilter` if present
6. Score and return top-K results

### Composition Notes
- Knowledge Graph results can be passed to **RAG** for a generated summary of the entity's
  article network
- Can be added to **Hybrid** as a third strategy to augment BM25 + Vector with entity recall
- Entity extraction at ingest adds ~1–2 Gemini API calls per article; this can be batched or
  deferred to an async worker using the existing BullMQ queue

### Tradeoffs / Limitations
- Entity extraction quality depends on Gemini; ambiguous proper nouns (e.g. "Apple" as company
  vs. fruit) require disambiguation context
- Graph traversal beyond 2 hops produces low-relevance results in most personal-corpus sizes
- Entity deduplication across articles is hard: "OpenAI", "Open AI", and "open ai" must resolve
  to the same canonical entity
- Ingest cost is higher than other modules; not suitable for real-time ingest without async queuing

---

## Strategy Selection — Runtime Routing

The `queryUnderstanding` layer (`apps/api/src/services/queryUnderstanding.ts`) selects one or
more modules at runtime by calling `strategy.supports(queryType)` on each registered module.
Selection priority:

| Query signal | Primary module | Optional second module |
|---|---|---|
| Specific content question | Vector | — |
| Keyword / code term lookup | BM25 | — |
| Time-scoped enumeration | Metadata (pre-filter) | Vector |
| Topic + time scope | Hybrid (BM25 + Vector) | — |
| Entity-centric question | KnowledgeGraph | — |
| CSV data question | CSV | — |
| Any of the above + "explain" | RAG (wrapping above) | — |

The `QueryIntent.retrieval_mode` field returned by Gemini maps to the strategy name; the
routing layer translates the mode string to a module instance.

---

## Upgrade Path from Current System

The existing three-mode system maps to the new modules as follows:

| Current mode | Module equivalent |
|---|---|
| `semantic_search` | Vector |
| `list_then_summarize` | Metadata (date filter) + enumeration logic in chatService |
| `hybrid` | Metadata (date filter) wrapped around Vector |

The new `hybrid` module supersedes the current `hybrid` mode by adding BM25 fusion on top of
the date-filtered vector search.
