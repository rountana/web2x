# Algorithm Plan — Metadata Filter Utility

**Phase:** 1 (Core Retrieval Contract)  
**Status:** Planning  
**Spec:** [search-algorithms.md](../tech-specs/dev-features/search-algorithms.md#module-2--metadata)  
**Phasewise plan:** [search-algorithms-implementation-plan.md](./search-algorithms-implementation-plan.md) — Task 1.2

---

## What it does

A shared SQL predicate builder that every other strategy module uses to narrow results by
structured document attributes. It is not a standalone strategy — it is a utility that
translates a `MetadataFilter` object into a composable Drizzle `SQL` fragment, injected into
the `WHERE` clause of whichever module calls it.

---

## Prerequisites

- Task 1.1 complete: `MetadataFilter` and `SearchQuery` types exported from
  `packages/shared/src/index.ts`
- No schema changes required for v1 (uses columns that already exist: `workspace_id`,
  `created_at` on `articles`)

---

## v1 Scope

v1 supports only the three fields the current `articles` table provides:

| Field | Source column | Operator |
|---|---|---|
| `workspaceId` | `articles.workspace_id` | `=` |
| `dateFrom` | `articles.created_at` | `>=` |
| `dateTo` | `articles.created_at` | `<=` |

The full filter set (`sourceType`, `domain`, `language`, `tags`, `readingTimeMin/Max`) is
deferred to Phase 5 when those columns are added to the `articles` table.

---

## Tasks

### Task M-1 — Create metadataFilter.ts
**New file:** `apps/api/src/services/search/metadataFilter.ts`

Exports a single function: `buildMetadataWhere(filters: MetadataFilter, tableAlias?: string)`

Behaviour:
- Accepts a `MetadataFilter` and an optional table alias (defaults to `'a'` for the
  `articles` table)
- Returns a Drizzle `SQL` fragment built with the `sql` tagged template
- The fragment is safe to concatenate directly into a `WHERE` clause
- All conditions are AND-joined
- If a field is absent from `filters`, its condition is omitted entirely — no dead clauses
- `workspaceId` is always required and always emitted

This function is the single place date and workspace filtering logic lives. Every strategy
imports it instead of reimplementing the clauses.

---

## Files touched

| File | Change type |
|---|---|
| `apps/api/src/services/search/metadataFilter.ts` | New |
| `packages/shared/src/index.ts` | Prerequisite — `MetadataFilter` type added in Task 1.1 |

---

## Phase 5 expansion

When `0006_article_metadata.sql` lands, this function gains support for:
- `sourceType` — equality on `articles.source_type`
- `domain` — equality on `articles.domain`
- `language` — equality on `articles.language`
- `tags` — array overlap (`&&`) on `articles.tags`
- `readingTimeMin/Max` — range on `articles.reading_time_seconds`

No other files need to change when these fields are added — callers already pass the full
`MetadataFilter` object; the utility simply starts using the new fields.

---

## Verification

No runtime verification is possible for this utility in isolation. It is implicitly verified
when each strategy module that uses it passes its own verification check.
