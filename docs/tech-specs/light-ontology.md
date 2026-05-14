# Lightweight Ontology — Design Spec

**Status:** Design
**Last updated:** 2026-05-07
**Parent:** [`dev-features/search-algorithms.md`](./dev-features/search-algorithms.md) — Module 7 (Knowledge Graph)
**Phase:** Phase 4 prerequisite

---

## Overview

The Knowledge Graph module (Phase 4) extracts entity–relation triples from each ingested article using
Gemini. Without a controlled vocabulary, the resulting graph is unusable: predicates proliferate
(`founded` / `started` / `co-founded` / `was the founder of`), entity types are inconsistent, and
graph traversal queries return nonsense.

This spec defines the **lightweight ontology** that constrains extraction and query: a closed set of
entity types, a closed predicate vocabulary, and a type-compatibility matrix between them. It is
intentionally not full OWL/RDF — no inference engine, no SPARQL, no triple store. Three layers of
controlled vocabulary on top of the schema already specified in
[`dev-features/search-algorithms.md`](./dev-features/search-algorithms.md#module-7--knowledge-graph).

---

## Why an ontology

Without it, the queries that motivate the Knowledge Graph in the first place — multi-hop reasoning,
type-filtered enumeration, provenance — fail in practice. The failure modes are predictable:

| Failure | Cause | With ontology |
|---|---|---|
| "Sam Altman" / "S. Altman" / "Samuel Altman" become 3 nodes | No canonical-name discipline | Single node, surface forms in `aliases` |
| Predicate proliferation breaks traversal | Free-text predicate column | Whitelisted predicate enum |
| Type errors like `(Apple, has_colour, red)` when Apple is a company | No type constraints on triples | Predicate signature enforced at insert |
| "AI companies" enumeration returns false positives from text matches | No type axis | Filter by `entity.type` directly |

---

## The three layers

### Layer 1 — Entity types (closed enum)

Six types, defined by the existing `entity_type` PostgreSQL enum in migration
`0005_knowledge_graph.sql`:

| Type | Examples | Notes |
|---|---|---|
| `person` | Sam Altman, Geoffrey Hinton, Ada Lovelace | Human individuals |
| `organisation` | OpenAI, Google, Stanford University | Companies, universities, governments, projects |
| `location` | San Francisco, the EU, MIT campus | Physical or jurisdictional places |
| `concept` | RAG, CAP theorem, Bayesian inference | Abstract ideas, theories, fields |
| `technology` | GPT-4, pgvector, HNSW, React | Products, systems, tools, libraries |
| `other` | Anything that doesn't fit | Strict catch-all; should be < 5% of nodes |

**Out of v1, planned for v2:** `work` (papers, books, articles, films). External citation graphs
(`cites`) are blocked on this. Until then, attributed external works are modelled as `concept`.

### Layer 2 — Predicate vocabulary (controlled list)

11 predicates. The set is deliberately tight — easier to expand later than to deduplicate after the
fact.

| Predicate | Meaning | Direction |
|---|---|---|
| `isA` | Taxonomic / instance-of | Specific → General |
| `partOf` | Composition / containment | Component → Whole |
| `locatedIn` | Geographic containment | Inhabitant → Place |
| `authored` | Created a work, theory, or idea | Creator → Output |
| `founded` | Established an organisation | Founder → Org |
| `worksAt` | Employment / formal affiliation | Person → Org |
| `memberOf` | Non-employment affiliation (group, society, movement) | Person → Group |
| `developed` | Built / created a technology | Builder → Tech |
| `influencedBy` | Intellectual or causal influence | Influenced → Influencer |
| `precedes` | Temporal or causal precedence (within a domain) | Earlier → Later |
| `relatedTo` | Escape hatch — use only when nothing else fits | Symmetric |

**Notes on what's deliberately omitted:**

- `mentions` and `about` are not predicates in the triple store — they're already encoded by the
  `article_entities` join table, which links articles to the entities mentioned in them. Putting them
  in `triples` would duplicate this signal.
- `cites` is omitted in v1 because it requires the `work` entity type. Internal article-to-article
  citations are not modelled in the entity graph at all in v1; they belong in a separate
  `article_links` table when needed.
- `relatedTo` exists as an escape hatch but Gemini extraction should be tuned to avoid it. Track its
  usage rate as a quality metric — high `relatedTo` rate means the vocabulary is too narrow or
  Gemini is being lazy.

### Layer 3 — Type constraints per predicate

Each predicate has an allowed `(subject_type, object_type)` signature. Triples that don't match are
rejected at insert time.

| Predicate | Subject type(s) | Object type(s) |
|---|---|---|
| `isA` | `person`, `organisation`, `location`, `technology`, `concept` | `concept` |
| `partOf` | `organisation`, `location`, `concept`, `technology` | Same broad category as subject |
| `locatedIn` | `person`, `organisation`, `location` | `location` |
| `authored` | `person`, `organisation` | `concept` |
| `founded` | `person` | `organisation` |
| `worksAt` | `person` | `organisation` |
| `memberOf` | `person` | `organisation`, `concept` |
| `developed` | `person`, `organisation` | `technology` |
| `influencedBy` | `person`, `concept` | `person`, `concept` |
| `precedes` | `concept`, `technology` | Same type as subject |
| `relatedTo` | Any | Any |

A `(subject_type, predicate, object_type)` triple that doesn't appear in this matrix is rejected at
insert time. Rejection is **dropped + logged**, not coerced — coercion silently corrupts the graph.

---

## Schema integration

The ontology layers slot onto the schema already specified in
[`search-algorithms.md`](./dev-features/search-algorithms.md#module-7--knowledge-graph) (migration
`0005_knowledge_graph.sql`):

```
entities         (id, workspace_id, canonical_name, type, aliases JSONB)
triples          (id, workspace_id, subject_entity_id, predicate, object_entity_id, source_article_id)
article_entities (article_id, entity_id, mention_count)
```

Two additions to that schema are required:

1. **`triples.predicate` becomes a typed enum** — change the column type from `text` to a new
   `predicate_type` PostgreSQL enum with the 11 values above. This makes invalid predicates a DB-level
   error rather than silent data quality erosion.

2. **A `predicate_constraints` table or static matrix in code** — encodes the type matrix. Two
   options:
   - **Code (recommended for v1):** a static `PREDICATE_CONSTRAINTS` table in
     `apps/api/src/services/ontology.ts` consulted by the entity extractor.
   - **DB CHECK constraint:** trigger that joins `triples` to `entities` on insert and validates.
     Stricter (DB enforces it for any client) but harder to evolve as the matrix changes.

   Code-side validation is fine for v1 — the only insert path is the entity extractor, which can
   call the validator directly.

### Canonical-name normalisation

- Apply `lower(trim(name))` before insert
- Use `INSERT … ON CONFLICT (workspace_id, canonical_name) DO NOTHING RETURNING id`
- Append unseen surface forms to `aliases` via `jsonb_insert` (deduplicated)
- A separate periodic reconciliation job can collapse `Open AI` ↔ `OpenAI` once a fuzzy-match policy
  is decided (out of scope for v1; see techdebt note in the Phase 4 KG spec)

---

## Extraction-time enforcement

The Gemini extractor (planned: `apps/api/src/services/entityExtractor.ts`) is configured with a
**structured-output `responseSchema`** that:

1. Fixes the entity-type enum to the 6 values above
2. Fixes the predicate enum to the 11 values above
3. Returns triples in the shape `{ subject, subject_type, predicate, object, object_type }`

After Gemini returns, a validator pass:

1. Looks up `(subject_type, predicate, object_type)` in `PREDICATE_CONSTRAINTS`
2. Drops triples that don't match — logs at `warn` level with the full triple for offline review
3. Inserts surviving triples in a single batch with FK resolution to `entities.id`

Drop rate is a quality metric. A healthy corpus should see < 5% of triples dropped. Higher rates mean
either the vocabulary needs expansion or the Gemini prompt is not constraining the model strongly
enough.

---

## Query patterns enabled

The ontology unlocks classes of queries that pure text/embedding search cannot reach.

### Type-filtered enumeration

```
SELECT canonical_name, mention_count
FROM entities e
JOIN article_entities ae ON ae.entity_id = e.id
WHERE e.workspace_id = $w AND e.type = 'person'
GROUP BY e.id, canonical_name
ORDER BY SUM(mention_count) DESC
LIMIT 20
```

User-facing: "who are the people I've read about most?" / "list every AI company in my corpus."

### Predicate-driven lookup

```
SELECT obj.canonical_name
FROM triples t
JOIN entities subj ON subj.id = t.subject_entity_id AND subj.canonical_name = 'sam altman'
JOIN entities obj  ON obj.id  = t.object_entity_id
WHERE t.predicate = 'founded'
```

User-facing: "what did Sam Altman found?" / "who works at OpenAI?"

### Multi-hop reasoning

```
-- Articles about people who founded AI companies
SELECT DISTINCT a.id, a.title
FROM articles a
JOIN article_entities ae   ON ae.article_id = a.id
JOIN entities person       ON person.id = ae.entity_id AND person.type = 'person'
JOIN triples t             ON t.subject_entity_id = person.id AND t.predicate = 'founded'
JOIN entities org          ON org.id = t.object_entity_id AND org.type = 'organisation'
JOIN triples isAi          ON isAi.subject_entity_id = org.id AND isAi.predicate = 'isA'
JOIN entities aiConcept    ON aiConcept.id = isAi.object_entity_id
                              AND aiConcept.canonical_name IN ('ai', 'artificial intelligence')
WHERE a.workspace_id = $w
```

User-facing: "articles about people who founded AI companies."

### Co-occurrence

```
-- Entities that frequently appear in the same articles as :OpenAI
SELECT e2.canonical_name, e2.type, COUNT(*) AS shared_articles
FROM article_entities a1
JOIN article_entities a2 ON a2.article_id = a1.article_id AND a2.entity_id != a1.entity_id
JOIN entities e1 ON e1.id = a1.entity_id AND e1.canonical_name = 'openai'
JOIN entities e2 ON e2.id = a2.entity_id
GROUP BY e2.id, e2.canonical_name, e2.type
ORDER BY shared_articles DESC
LIMIT 20
```

User-facing: "who appears alongside OpenAI in my reading?"

### Provenance / first-seen

```
SELECT a.id, a.title, a.created_at
FROM articles a
JOIN article_entities ae ON ae.article_id = a.id
JOIN entities e          ON e.id = ae.entity_id AND e.canonical_name = 'hnsw'
WHERE a.workspace_id = $w
ORDER BY a.created_at ASC
LIMIT 1
```

User-facing: "where did I first encounter HNSW?" The flagship personal-knowledge query — and one
that no other tool does well.

### Discovery / recommendation

```
-- Concepts 1 hop from my most-mentioned concepts that I haven't seen yet
WITH top_concepts AS (
  SELECT e.id FROM entities e
  JOIN article_entities ae ON ae.entity_id = e.id
  WHERE e.type = 'concept' AND e.workspace_id = $w
  GROUP BY e.id ORDER BY SUM(ae.mention_count) DESC LIMIT 10
)
SELECT DISTINCT obj.canonical_name
FROM triples t
JOIN top_concepts tc ON tc.id = t.subject_entity_id
JOIN entities obj    ON obj.id = t.object_entity_id AND obj.type = 'concept'
LEFT JOIN article_entities seen ON seen.entity_id = obj.id
WHERE seen.entity_id IS NULL  -- not yet read
```

User-facing: "concepts I should explore next."

### Cross-source bridging

CSV column values can be matched against entities to bridge the article and CSV worlds:

```
-- CSV rows where the assignee field matches a person in my article corpus
SELECT r.metadata, ent.canonical_name
FROM csv_rows r
JOIN entities ent
  ON lower(r.metadata->>'assignee') = ent.canonical_name
 AND ent.type = 'person'
WHERE r.workspace_id = $w
```

User-facing: "show me CSV rows whose assignee matches an author I've been reading."

### Hybrid (ontology + retrieval strategy)

The ontology produces an entity → article-id set. That set is a `MetadataFilter`-compatible
predicate that any other strategy can apply:

- Vector search restricted to articles mentioning a specific entity
- BM25 over article-chunks pre-filtered to the entity's article set
- RAG with the inner retriever set to "Hybrid + entity filter"

This is where the ontology compounds with the retrieval modules already shipped.

---

## What this does not enable

Honest scope:

- **Quantitative reasoning** — "what fraction of AI articles cite RAG" needs aggregation logic
  layered on top
- **Causal / counterfactual queries** — "what would have happened if X" is out of scope; the
  ontology models what *is*
- **Sentiment / stance** — "articles critical of OpenAI" needs a separate sentiment classifier
- **Temporal validity of facts** — "who was CEO of X in 2022" — `triples` has `source_article_id`
  but no `validFrom` / `validTo`. Adding it later is a schema change
- **Quality / authority weighting** — every triple is weighed equally; for research-grade tooling
  you'd eventually need source-credibility weights
- **External citation graphs** — blocked on adding `work` as a 7th entity type (see Layer 1 v2 note)

---

## Failure modes and quality metrics

Three numbers to track once Phase 4 ships:

| Metric | Healthy range | What it tells you |
|---|---|---|
| Triple drop rate (% rejected by validator) | < 5% | Vocabulary fit — high rate means too narrow or extractor too noisy |
| `relatedTo` usage (% of all triples) | < 15% | Predicate specificity — high rate means Gemini is reaching for the escape hatch |
| Entity duplication rate (canonical names within Levenshtein-3 of each other) | < 10% | Canonicalisation quality — high rate signals need for a reconciliation job |

When any of these breach the healthy range, the response is:

- High drop rate → expand the matrix (e.g. add a missing predicate) or tighten the Gemini prompt
- High `relatedTo` → audit dropped triples for missing predicates worth adding
- High duplication → run the reconciliation job, then revisit canonical-name normalisation

---

## File map

```
apps/api/src/
├── services/
│   ├── ontology.ts                              ← New: PREDICATE_CONSTRAINTS, validator, types
│   ├── entityExtractor.ts                       ← Phase 4: uses ontology.ts schema in Gemini call
│   └── search/knowledgeGraphStrategy.ts         ← Phase 4: filters by ontology types in queries
└── db/migrations/
    └── 0005_knowledge_graph.sql                 ← Phase 4: + predicate_type enum
```

Single new module (`ontology.ts`) carries the predicate set, type matrix, validator, and Gemini
schema generator. Phase 4 KG tasks consume it.

---

## Cross-references

- Knowledge Graph module spec: [`dev-features/search-algorithms.md`](./dev-features/search-algorithms.md#module-7--knowledge-graph)
- Phase 4 task list: [`../plans/algorithm-knowledge-graph.md`](../plans/algorithm-knowledge-graph.md)
- Strategy interface: [`dev-features/search-algorithms.md`](./dev-features/search-algorithms.md#shared-interface-contract)
