-- Track which embedding model produced each chunk so vector search only compares
-- compatible vectors. Existing rows default to the MLX model used at index time.
ALTER TABLE "article_chunks"
  ADD COLUMN "embedding_model" text NOT NULL DEFAULT 'mlx/nomic-embed-text-v1.5';
