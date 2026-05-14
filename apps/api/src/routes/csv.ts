import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and, desc } from 'drizzle-orm';
import { db } from '../db/client.js';
import { csvUploads, csvRows, type CsvColumnSchema, type CsvColumnType } from '../db/schema.js';
import { ValidationError } from '../middleware/error.js';
import type { WorkspaceEnv } from '../middleware/workspace.js';

export const csvRouter = new Hono<WorkspaceEnv>();

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const SAMPLE_ROWS_FOR_INFERENCE = 50;
const INSERT_BATCH_SIZE = 500;

// ── CSV parser ──────────────────────────────────────────────────────────────
// Handles RFC-4180 basics: quoted fields, doubled quotes, embedded newlines
// inside quotes. Empty trailing lines are skipped.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        field += ch;
        i++;
      }
      continue;
    }

    if (ch === '"' && field.length === 0) {
      inQuotes = true;
      i++;
    } else if (ch === ',') {
      row.push(field);
      field = '';
      i++;
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      if (row.length > 1 || field !== '' || row[0] !== '') rows.push(row);
      row = [];
      field = '';
      i++;
    } else {
      field += ch;
      i++;
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

// ── Type inference ──────────────────────────────────────────────────────────
const NUMERIC_REGEX = /^-?\d+(\.\d+)?$/;
const BOOLEAN_REGEX = /^(true|false|yes|no|1|0)$/i;
// ISO 8601 date or datetime — strict to avoid Date.parse() catching arbitrary text
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

export function inferType(values: string[]): CsvColumnType {
  const nonEmpty = values.map((v) => v.trim()).filter((v) => v !== '');
  if (nonEmpty.length === 0) return 'text';

  if (nonEmpty.every((v) => NUMERIC_REGEX.test(v))) return 'numeric';
  if (nonEmpty.every((v) => BOOLEAN_REGEX.test(v))) return 'boolean';
  if (nonEmpty.every((v) => DATE_REGEX.test(v))) return 'date';
  return 'text';
}

export function coerceValue(value: string, type: CsvColumnType): unknown {
  const v = value.trim();
  if (v === '') return null;
  switch (type) {
    case 'numeric': {
      const n = Number(v);
      return Number.isFinite(n) ? n : v;
    }
    case 'boolean':
      return /^(true|yes|1)$/i.test(v);
    case 'date':
      return v;
    default:
      return value;
  }
}

// ── Routes ──────────────────────────────────────────────────────────────────

csvRouter.post('/upload', async (c) => {
  const workspace = c.get('workspace');

  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    throw new ValidationError('Multipart form data with a "file" field is required');
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    throw new ValidationError('file is required');
  }
  if (file.size === 0) {
    throw new ValidationError('file is empty');
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new ValidationError(`file too large (max ${MAX_FILE_BYTES / 1024 / 1024} MB)`);
  }

  const text = await file.text();
  const rows = parseCsv(text);
  if (rows.length < 2) {
    throw new ValidationError('CSV must have a header row and at least one data row');
  }

  const rawHeaders = rows[0].map((h) => h.trim());
  if (rawHeaders.some((h) => h === '')) {
    throw new ValidationError('CSV header row contains empty column names');
  }

  // Deduplicate header names — append a numeric suffix to collisions
  const seen = new Map<string, number>();
  const headers = rawHeaders.map((h) => {
    const count = seen.get(h) ?? 0;
    seen.set(h, count + 1);
    return count === 0 ? h : `${h}_${count}`;
  });

  const dataRows = rows.slice(1);
  const sampleSize = Math.min(SAMPLE_ROWS_FOR_INFERENCE, dataRows.length);

  const columnSchema: CsvColumnSchema[] = headers.map((name, colIdx) => {
    const values = dataRows.slice(0, sampleSize).map((r) => r[colIdx] ?? '');
    return { name, type: inferType(values) };
  });

  const [upload] = await db
    .insert(csvUploads)
    .values({
      workspaceId: workspace.id,
      filename: file.name,
      columnSchema,
      rowCount: dataRows.length,
    })
    .returning();

  // Batch insert rows
  for (let offset = 0; offset < dataRows.length; offset += INSERT_BATCH_SIZE) {
    const batch = dataRows.slice(offset, offset + INSERT_BATCH_SIZE).map((row, idx) => {
      const metadata: Record<string, unknown> = {};
      const textParts: string[] = [];
      for (let col = 0; col < headers.length; col++) {
        const raw = row[col] ?? '';
        const schema = columnSchema[col];
        metadata[schema.name] = coerceValue(raw, schema.type);
        if (schema.type === 'text' && raw.trim() !== '') textParts.push(raw);
      }
      return {
        uploadId: upload.id,
        workspaceId: workspace.id,
        rowIndex: offset + idx,
        metadata,
        content: textParts.join(' '),
      };
    });
    await db.insert(csvRows).values(batch);
  }

  return c.json({
    id: upload.id,
    filename: upload.filename,
    rowCount: upload.rowCount,
    columnSchema: upload.columnSchema,
  });
});

csvRouter.get('/', async (c) => {
  const workspace = c.get('workspace');
  const uploads = await db
    .select({
      id: csvUploads.id,
      filename: csvUploads.filename,
      columnSchema: csvUploads.columnSchema,
      rowCount: csvUploads.rowCount,
      createdAt: csvUploads.createdAt,
    })
    .from(csvUploads)
    .where(eq(csvUploads.workspaceId, workspace.id))
    .orderBy(desc(csvUploads.createdAt));
  return c.json({ uploads });
});

csvRouter.delete('/:id', async (c) => {
  const workspace = c.get('workspace');
  const id = c.req.param('id');
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) throw new ValidationError('Invalid id');

  const result = await db
    .delete(csvUploads)
    .where(and(eq(csvUploads.id, id), eq(csvUploads.workspaceId, workspace.id)))
    .returning({ id: csvUploads.id });

  if (result.length === 0) return c.json({ error: 'Not found' }, 404);

  return c.json({ success: true });
});
