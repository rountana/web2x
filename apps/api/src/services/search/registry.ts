import { BM25Strategy } from './bm25Strategy.js';
import { VectorStrategy } from './vectorStrategy.js';
import { HybridStrategy } from './hybridStrategy.js';
import { RagStrategy } from './ragStrategy.js';
import { CsvStrategy } from './csvStrategy.js';
import { MetadataStrategy } from './metadataStrategy.js';
import type { QueryType, SearchStrategy } from '@web2x/shared';

const bm25 = new BM25Strategy();
const vector = new VectorStrategy();
const hybrid = new HybridStrategy([bm25, vector]);
const rag = new RagStrategy(hybrid);
const csv = new CsvStrategy();
const metadata = new MetadataStrategy();

const registry: Partial<Record<QueryType, SearchStrategy>> = {
  vector,
  semantic_search: vector,
  bm25,
  hybrid,
  rag,
  csv,
  metadata,
  // knowledge_graph: registered in Phase 4
};

export function resolveStrategy(mode: QueryType): SearchStrategy | null {
  return registry[mode] ?? null;
}
