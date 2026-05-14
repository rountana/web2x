-- Add full-text search vector to article_chunks for BM25 keyword search.
-- STORED generated column: PostgreSQL maintains it automatically on insert/update.
-- Backfill of existing rows happens implicitly when the column is added.
ALTER TABLE article_chunks
  ADD COLUMN search_vector tsvector
    GENERATED ALWAYS AS (to_tsvector('english', content)) STORED;

-- GIN index enables fast @@ operator lookups.
CREATE INDEX article_chunks_search_vector_idx
  ON article_chunks USING GIN(search_vector);
