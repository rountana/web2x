import { sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { buildMetadataWhere } from './metadataFilter.js';
import type { SearchQuery, SearchResult, SearchStrategy, QueryType, MetadataFilter } from '@web2x/shared';

interface ArticleRow extends Record<string, unknown> {
  id: string;
  title: string;
  source_url: string;
  word_count: number;
  created_at: string;
  markdown_content: string;
}

export interface ParsedTemporal {
  dateFrom?: string;
  dateTo?: string;
}

const RELATIVE_TEMPORAL: Array<{ regex: RegExp; days: number }> = [
  { regex: /\b(?:this|past|last)\s+week\b/i, days: 7 },
  { regex: /\b(?:this|past|last)\s+month\b/i, days: 30 },
  { regex: /\b(?:this|past|last)\s+year\b/i, days: 365 },
  { regex: /\brecent(?:ly)?\b/i, days: 14 },
];

// Use \d+ rather than \d{1,3} so the Math.min clamp downstream actually fires
// for unrealistically large inputs. Without this, 4+ digit inputs silently
// fall through to "no temporal phrase detected".
const NUM_DAYS_REGEX = /\b(?:past|last)\s+(\d+)\s+days?\b/i;
const EXPLICIT_DATE_REGEX = /\b(after|before|from|to|since|until):(\d{4}-\d{2}-\d{2})\b/gi;

export function parseTemporal(text: string): ParsedTemporal {
  let dateFrom: string | undefined;
  let dateTo: string | undefined;
  const now = Date.now();

  for (const match of text.matchAll(EXPLICIT_DATE_REGEX)) {
    const op = match[1].toLowerCase();
    const dateStr = match[2];
    if (op === 'after' || op === 'from' || op === 'since') {
      dateFrom = `${dateStr}T00:00:00.000Z`;
    } else {
      dateTo = `${dateStr}T23:59:59.999Z`;
    }
  }

  if (!dateFrom) {
    if (/\btoday\b/i.test(text)) {
      const start = new Date();
      start.setUTCHours(0, 0, 0, 0);
      dateFrom = start.toISOString();
    } else if (/\byesterday\b/i.test(text)) {
      const start = new Date();
      start.setUTCDate(start.getUTCDate() - 1);
      start.setUTCHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setUTCHours(23, 59, 59, 999);
      dateFrom = start.toISOString();
      if (!dateTo) dateTo = end.toISOString();
    } else {
      const numMatch = text.match(NUM_DAYS_REGEX);
      if (numMatch) {
        const days = Math.min(parseInt(numMatch[1], 10), 3650);
        dateFrom = new Date(now - days * 86_400_000).toISOString();
      } else {
        for (const { regex, days } of RELATIVE_TEMPORAL) {
          if (regex.test(text)) {
            dateFrom = new Date(now - days * 86_400_000).toISOString();
            break;
          }
        }
      }
    }
  }

  return { dateFrom, dateTo };
}

export class MetadataStrategy implements SearchStrategy {
  readonly name: QueryType = 'metadata';

  supports(queryType: QueryType): boolean {
    return queryType === 'metadata';
  }

  score(result: SearchResult): number {
    return result.score;
  }

  async search(query: SearchQuery): Promise<SearchResult[]> {
    const topK = query.topK ?? 8;
    const baseFilters: MetadataFilter = query.filters ?? { workspaceId: query.workspaceId };
    const parsed = parseTemporal(query.text);

    const filters: MetadataFilter = {
      workspaceId: baseFilters.workspaceId,
      dateFrom: parsed.dateFrom ?? baseFilters.dateFrom,
      dateTo: parsed.dateTo ?? baseFilters.dateTo,
    };

    const metaWhere = buildMetadataWhere(filters);

    const rows = await db.execute<ArticleRow>(sql`
      SELECT
        a.id,
        a.title,
        a.source_url,
        a.word_count,
        a.created_at,
        a.markdown_content
      FROM articles a
      WHERE ${metaWhere}
        AND a.status = 'ready'
      ORDER BY a.created_at DESC
      LIMIT ${topK}
    `);

    const total = rows.rows.length;
    if (total === 0) return [];

    return rows.rows.map((row, i) => ({
      id: row.id,
      articleId: row.id,
      score: 1 - 0.4 * (i / Math.max(total - 1, 1)),
      content: (row.markdown_content ?? '').slice(0, 500) || row.title,
      metadata: {
        title: row.title,
        sourceUrl: row.source_url,
        wordCount: row.word_count,
        createdAt: row.created_at,
        ...(filters.dateFrom ? { dateFrom: filters.dateFrom } : {}),
        ...(filters.dateTo ? { dateTo: filters.dateTo } : {}),
      },
      source: 'metadata' as QueryType,
    }));
  }
}
