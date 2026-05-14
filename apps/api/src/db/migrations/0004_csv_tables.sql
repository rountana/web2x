-- CSV ingestion: tabular data sources searchable via column filters + BM25
CREATE TABLE csv_uploads (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  filename      text NOT NULL,
  column_schema jsonb NOT NULL,                  -- [{ name, type: 'text'|'numeric'|'date'|'boolean' }]
  row_count     integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE csv_rows (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id    uuid NOT NULL REFERENCES csv_uploads(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL,
  row_index    integer NOT NULL,
  metadata     jsonb NOT NULL,                   -- typed column values keyed by column name
  content      text NOT NULL,                    -- concatenated free-text columns for BM25
  search_vector tsvector
    GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX csv_uploads_workspace_idx ON csv_uploads(workspace_id);
CREATE INDEX csv_rows_upload_idx       ON csv_rows(upload_id);
CREATE INDEX csv_rows_workspace_idx    ON csv_rows(workspace_id);
CREATE INDEX csv_rows_search_vec_idx   ON csv_rows USING GIN(search_vector);
CREATE INDEX csv_rows_metadata_idx     ON csv_rows USING GIN(metadata);
