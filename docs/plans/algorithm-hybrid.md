# Algorithm Plan — Hybrid Strategy (RRF)

**Phase:** 1 (Core Retrieval Contract)  
**Status:** Planning  
**Spec:** [search-algorithms.md](../tech-specs/dev-features/search-algorithms.md#module-6--hybrid)  
**Phasewise plan:** [search-algorithms-implementation-plan.md](./search-algorithms-implementation-plan.md) — Task 1.5

---

## What it does

Fuses result lists from two or more `SearchStrategy` modules into a single ranked list using
Reciprocal Rank Fusion (RRF). Default pairing is BM25 + Vector. RRF is rank-based — it
requires no score calibration across strategies, no trained model, and no extra infrastructure.

This supersedes the existing `hybrid` mode in `chat.ts`, which does vector search with a date
filter but does not combine BM25 results.

---

## Prerequisites

- Task 1.1 complete: shared types in `packages/shared/src/index.ts`
- Task 1.3 complete: `VectorStrategy` available at
  `apps/api/src/services/search/vectorStrategy.ts`
- Task 1.4 complete: `BM25Strategy` available at
  `apps/api/src/services/search/bm25Strategy.ts`
- No schema changes required — Hybrid is pure composition

---

## Tasks

### Task H-1 — Create hybridStrategy.ts
**New file:** `apps/api/src/services/search/hybridStrategy.ts`

Constructor accepts `strategies: SearchStrategy[]` (must be at least 2). The default
instance created by the registry uses `[BM25Strategy, VectorStrategy]`.

The module must:

**Step 1 — Parallel fetch**  
Execute all configured strategies concurrently against the same `SearchQuery`. Each strategy
fetches `topK` results independently (default `topK = 10` per strategy before fusion,
configurable via `SearchQuery.options.rrf_per_strategy_k`).

**Step 2 — RRF scoring**  
For each unique result across all lists, compute:
```
RRF(result) = sum over all lists of  1 / (rrf_k + rank_in_list)
```
Where `rrf_k` defaults to 60 (configurable via `SearchQuery.options.rrf_k`).
A result absent from a list contributes 0 from that list.

**Step 3 — Deduplicate and sort**  
Deduplicate by `result.id`. Sort descending by RRF score. Truncate to `fusedTopK` (default 8,
configurable via `SearchQuery.options.fused_top_k`).

**Step 4 — Normalise and annotate**  
Normalise RRF scores to `[0, 1]` (divide by max RRF score in the set). Set `result.source`
to `'hybrid'` and carry forward each result's original content and metadata.

- `name`: `'hybrid'`
- `supports()`: true for `'hybrid'`
- `score()`: identity — RRF scores set during search

### Task H-2 — Register in registry.ts
**File:** `apps/api/src/services/search/registry.ts`

Add `HybridStrategy` under the `'hybrid'` key, instantiated with
`[new BM25Strategy(), new VectorStrategy()]`.

### Task H-3 — Update queryUnderstanding.ts
**File:** `apps/api/src/services/queryUnderstanding.ts`

Ensure `'hybrid'` is a valid value (it already was in the original prompt). Update the
description in the Gemini prompt to reflect that `hybrid` now means RRF fusion of BM25 +
Vector, not just vector-with-date-filter. Specifically:
- `hybrid` should be selected when the query has both a keyword component and a semantic
  component, or when recall quality matters more than latency

---

## Files touched

| File | Change type |
|---|---|
| `apps/api/src/services/search/hybridStrategy.ts` | New |
| `apps/api/src/services/search/registry.ts` | Modify — register HybridStrategy |
| `apps/api/src/services/queryUnderstanding.ts` | Modify — update `hybrid` description in Gemini prompt |

---

## Configuration reference

| Option key | Default | Effect |
|---|---|---|
| `rrf_k` | `60` | Dampens influence of top-ranked results. Tune between 10–100. |
| `rrf_per_strategy_k` | `10` | How many results to fetch from each strategy before fusion |
| `fused_top_k` | `8` | Final result count returned after fusion |

---

## Verification

- `POST /workspaces/:id/chat { "query": "Python machine learning embeddings" }` — query
  intent should classify as `hybrid`; response should draw from both BM25 (exact term
  matches) and Vector (semantic matches) result sets
- Manually inspect that results absent from one strategy's list but present in the other's
  still appear in the fused output
- Verify that `rrf_k` of 60 produces stable ordering across repeated calls with the same query

---

## Risks

- Both strategies execute concurrently against the DB. Under high load they share the
  connection pool — ensure the pool limit is sufficient for 2× the single-strategy queries.
- If one strategy (e.g. BM25) returns zero results (all-stop-word query), the fusion falls
  back to the other strategy's ranking entirely. This is correct behaviour but should be
  confirmed with a test query.
