import { pgTable, uuid, text, integer, timestamp, jsonb, pgEnum, customType } from 'drizzle-orm/pg-core';
import type { FlashCard, QuizQuestion } from '@web2x/shared';

const tsvector = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'tsvector';
  },
  toDriver(value: string): string {
    return value;
  },
  fromDriver(value: string): string {
    return value;
  },
});

const vector = customType<{ data: number[]; driverData: string; config: { dimensions: number } }>({
  dataType(config) {
    return `vector(${config?.dimensions ?? 768})`;
  },
  toDriver(value: number[]): string {
    return `[${value.join(',')}]`;
  },
  fromDriver(value: string): number[] {
    return value.slice(1, -1).split(',').map(Number);
  },
});

export const articleStatusEnum = pgEnum('article_status', ['pending', 'ready', 'failed']);

export const workspaces = pgTable('workspaces', {
  id:        uuid('id').primaryKey().defaultRandom(),
  userId:    text('user_id').notNull(),
  name:      text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const articles = pgTable('articles', {
  id:              uuid('id').primaryKey().defaultRandom(),
  userId:          text('user_id'),
  workspaceId:     uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  sourceUrl:       text('source_url').notNull(),
  title:           text('title').notNull().default(''),
  rawText:         text('raw_text').notNull().default(''),
  markdownContent: text('markdown_content').notNull().default(''),
  wordCount:       integer('word_count').notNull().default(0),
  extractedAt:     timestamp('extracted_at', { withTimezone: true }),
  status:          articleStatusEnum('status').notNull().default('pending'),
  errorMessage:    text('error_message'),
  createdAt:       timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const decks = pgTable('decks', {
  id:          uuid('id').primaryKey().defaultRandom(),
  articleId:   uuid('article_id').notNull().references(() => articles.id, { onDelete: 'cascade' }),
  cards:       jsonb('cards').notNull().$type<FlashCard[]>(),
  generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const quizzes = pgTable('quizzes', {
  id:          uuid('id').primaryKey().defaultRandom(),
  articleId:   uuid('article_id').notNull().references(() => articles.id, { onDelete: 'cascade' }),
  questions:   jsonb('questions').notNull().$type<QuizQuestion[]>(),
  generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const summaries = pgTable('summaries', {
  id:          uuid('id').primaryKey().defaultRandom(),
  articleId:   uuid('article_id').notNull().references(() => articles.id, { onDelete: 'cascade' }),
  keyPoints:   jsonb('key_points').notNull().$type<string[]>(),
  overview:    text('overview').notNull(),
  generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const articleChunks = pgTable('article_chunks', {
  id:             uuid('id').primaryKey().defaultRandom(),
  articleId:      uuid('article_id').notNull().references(() => articles.id, { onDelete: 'cascade' }),
  chunkIndex:     integer('chunk_index').notNull(),
  content:        text('content').notNull(),
  embedding:      vector('embedding', { dimensions: 768 }),
  embeddingModel: text('embedding_model').notNull().default('mlx/nomic-embed-text-v1.5'),
  // searchVector is a STORED generated column maintained by PostgreSQL (see migration 0003).
  // Declared here for type awareness; never included in INSERT values.
  searchVector:   tsvector('search_vector'),
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type CsvColumnType = 'text' | 'numeric' | 'date' | 'boolean';
export interface CsvColumnSchema {
  name: string;
  type: CsvColumnType;
}

export const csvUploads = pgTable('csv_uploads', {
  id:           uuid('id').primaryKey().defaultRandom(),
  workspaceId:  uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  filename:     text('filename').notNull(),
  columnSchema: jsonb('column_schema').notNull().$type<CsvColumnSchema[]>(),
  rowCount:     integer('row_count').notNull().default(0),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const csvRows = pgTable('csv_rows', {
  id:           uuid('id').primaryKey().defaultRandom(),
  uploadId:     uuid('upload_id').notNull().references(() => csvUploads.id, { onDelete: 'cascade' }),
  workspaceId:  uuid('workspace_id').notNull(),
  rowIndex:     integer('row_index').notNull(),
  metadata:     jsonb('metadata').notNull().$type<Record<string, unknown>>(),
  content:      text('content').notNull(),
  // searchVector is a STORED generated column maintained by PostgreSQL (see migration 0004).
  // Declared here for type awareness; never included in INSERT values.
  searchVector: tsvector('search_vector'),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type WorkspaceRow     = typeof workspaces.$inferSelect;
export type NewWorkspace     = typeof workspaces.$inferInsert;
export type ArticleRow       = typeof articles.$inferSelect;
export type NewArticle       = typeof articles.$inferInsert;
export type DeckRow          = typeof decks.$inferSelect;
export type QuizRow          = typeof quizzes.$inferSelect;
export type SummaryRow       = typeof summaries.$inferSelect;
export type ArticleChunkRow  = typeof articleChunks.$inferSelect;
export type NewArticleChunk  = typeof articleChunks.$inferInsert;
export type CsvUploadRow     = typeof csvUploads.$inferSelect;
export type NewCsvUpload     = typeof csvUploads.$inferInsert;
export type CsvRowRow        = typeof csvRows.$inferSelect;
export type NewCsvRow        = typeof csvRows.$inferInsert;
