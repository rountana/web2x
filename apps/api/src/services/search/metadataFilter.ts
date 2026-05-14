import { sql, SQL } from 'drizzle-orm';
import type { MetadataFilter } from '@web2x/shared';

/**
 * Builds a composable Drizzle SQL predicate from a MetadataFilter.
 * All values are parameterised — no string interpolation of user data.
 *
 * @param filters  The filter object from SearchQuery.filters
 * @param alias    Table alias for the articles table (default: 'a')
 */
export function buildMetadataWhere(filters: MetadataFilter, alias = 'a'): SQL {
  const parts: SQL[] = [
    sql`${sql.raw(alias)}.workspace_id = ${filters.workspaceId}::uuid`,
  ];

  if (filters.dateFrom) {
    parts.push(sql`${sql.raw(alias)}.created_at >= ${filters.dateFrom}::timestamptz`);
  }

  if (filters.dateTo) {
    parts.push(sql`${sql.raw(alias)}.created_at <= ${filters.dateTo}::timestamptz`);
  }

  // Phase 5: sourceType, domain, language, tags, readingTimeMin, readingTimeMax

  return parts.reduce((acc, part) => sql`${acc} AND ${part}`);
}
