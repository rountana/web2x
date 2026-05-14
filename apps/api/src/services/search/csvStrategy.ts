import { sql, type SQL } from 'drizzle-orm';
import { db } from '../../db/client.js';
import type { SearchQuery, SearchResult, SearchStrategy, QueryType } from '@web2x/shared';

export type ConditionOp = '=' | '>' | '<' | '>=' | '<=' | 'contains';

export interface ParsedCondition {
  field: string;
  op: ConditionOp;
  value: string;
}

interface CsvSearchRow extends Record<string, unknown> {
  id: string;
  upload_id: string;
  row_index: number;
  metadata: Record<string, unknown>;
  content: string;
  filename: string;
  rank: number | null;
}

// Matches: field op value  — where value is a bare token or a "quoted string"
const CONDITION_REGEX = /([a-zA-Z_][\w]*)\s*(>=|<=|=|>|<|contains)\s*(?:"([^"]*)"|(\S+))/gi;

export function parseConditions(text: string): { conditions: ParsedCondition[]; remainder: string } {
  const conditions: ParsedCondition[] = [];
  let remainder = text;

  for (const match of [...text.matchAll(CONDITION_REGEX)]) {
    const [full, field, op, quotedValue, bareValue] = match;
    const value = quotedValue ?? bareValue ?? '';
    if (!value) continue;
    conditions.push({
      field: field.toLowerCase(),
      op: op.toLowerCase() as ConditionOp,
      value,
    });
    remainder = remainder.replace(full, ' ');
  }

  return { conditions, remainder: remainder.trim().replace(/\s+/g, ' ') };
}

function buildConditionClause(c: ParsedCondition): SQL | null {
  const isNumeric = /^-?[0-9]+(\.[0-9]+)?$/.test(c.value);

  if (c.op === '=') {
    if (isNumeric) {
      const num = Number(c.value);
      return sql`(
        lower(csv_rows.metadata->>${c.field}) = lower(${c.value})
        OR (
          (csv_rows.metadata->>${c.field}) ~ '^-?[0-9]+(\\.[0-9]+)?$'
          AND CAST(csv_rows.metadata->>${c.field} AS numeric) = ${num}
        )
      )`;
    }
    return sql`lower(csv_rows.metadata->>${c.field}) = lower(${c.value})`;
  }

  if (c.op === 'contains') {
    const escaped = c.value.replace(/[%_\\]/g, '\\$&');
    return sql`csv_rows.metadata->>${c.field} ILIKE ${'%' + escaped + '%'}`;
  }

  // Range operators only make sense for numeric values
  if (!isNumeric) return null;
  const num = Number(c.value);
  const opFragment =
    c.op === '>' ? sql`>` :
    c.op === '<' ? sql`<` :
    c.op === '>=' ? sql`>=` :
    sql`<=`;

  return sql`(
    (csv_rows.metadata->>${c.field}) ~ '^-?[0-9]+(\\.[0-9]+)?$'
    AND CAST(csv_rows.metadata->>${c.field} AS numeric) ${opFragment} ${num}
  )`;
}

export class CsvStrategy implements SearchStrategy {
  readonly name: QueryType = 'csv';

  supports(queryType: QueryType): boolean {
    return queryType === 'csv';
  }

  score(result: SearchResult): number {
    return result.score;
  }

  async search(query: SearchQuery): Promise<SearchResult[]> {
    const topK = query.topK ?? 8;
    const { conditions, remainder } = parseConditions(query.text);

    const conditionClauses = conditions
      .map(buildConditionClause)
      .filter((c): c is SQL => c !== null);

    const workspaceFilter = sql`csv_rows.workspace_id = ${query.workspaceId}::uuid`;

    // Tier 1: column-condition matches — score 1.0, ordered by recency
    let tier1: CsvSearchRow[] = [];
    if (conditionClauses.length > 0) {
      const merged = conditionClauses.reduce((acc, c) => sql`${acc} AND ${c}`);
      const result = await db.execute<CsvSearchRow>(sql`
        SELECT
          csv_rows.id,
          csv_rows.upload_id,
          csv_rows.row_index,
          csv_rows.metadata,
          csv_rows.content,
          csv_uploads.filename,
          NULL::float AS rank
        FROM csv_rows
        JOIN csv_uploads ON csv_uploads.id = csv_rows.upload_id
        WHERE ${workspaceFilter} AND ${merged}
        ORDER BY csv_rows.created_at DESC
        LIMIT ${topK}
      `);
      tier1 = result.rows;
    }

    // Tier 2: BM25 full-text on remainder — score normalised to [0, 0.9]
    let tier2: CsvSearchRow[] = [];
    if (remainder.length > 0 && tier1.length < topK) {
      const remaining = topK - tier1.length;
      const tier1Ids = tier1.map((r) => r.id);
      const excludeFilter = tier1Ids.length > 0
        ? sql`AND csv_rows.id NOT IN (${sql.join(tier1Ids.map((id) => sql`${id}::uuid`), sql`, `)})`
        : sql``;

      const result = await db.execute<CsvSearchRow>(sql`
        SELECT
          csv_rows.id,
          csv_rows.upload_id,
          csv_rows.row_index,
          csv_rows.metadata,
          csv_rows.content,
          csv_uploads.filename,
          ts_rank_cd(csv_rows.search_vector, query) AS rank
        FROM csv_rows
        JOIN csv_uploads ON csv_uploads.id = csv_rows.upload_id,
             websearch_to_tsquery('english', ${remainder}) query
        WHERE csv_rows.search_vector @@ query
          AND ${workspaceFilter}
          ${excludeFilter}
        ORDER BY rank DESC
        LIMIT ${remaining}
      `);
      tier2 = result.rows;
    }

    const tier2MaxRank = Math.max(...tier2.map((r) => r.rank ?? 0), 1);

    const buildResult = (row: CsvSearchRow, score: number): SearchResult => ({
      id: row.id,
      // articleId is reused for upload_id — CSV rows belong to an upload, not an article.
      // The frontend reads metadata.uploadId / metadata.filename for display.
      articleId: row.upload_id,
      score,
      content: row.content,
      metadata: {
        title: `${row.filename} · row ${row.row_index + 1}`,
        uploadId: row.upload_id,
        rowIndex: row.row_index,
        filename: row.filename,
        ...row.metadata,
      },
      source: 'csv' as QueryType,
    });

    return [
      ...tier1.map((r) => buildResult(r, 1.0)),
      ...tier2.map((r) => buildResult(r, ((r.rank ?? 0) / tier2MaxRank) * 0.9)),
    ];
  }
}
