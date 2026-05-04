/**
 * JAN (Job Accommodation Network) Search Service for AccommodateAI.
 *
 * Provides search capabilities against the acmd_jan_accommodations table.
 * Supports case-insensitive partial matching on condition + job_category.
 * Used directly by the JAN search API and as fallback when AI suggestion fails.
 */

import { db, acmdJanAccommodations } from '@acmd/db';
import { sql, ilike, and, or } from 'drizzle-orm';
import type { AcmdJanAccommodation } from '@acmd/db';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface JanSearchOptions {
  condition?: string;
  job?: string;
  limit?: number;
  offset?: number;
}

export interface JanSearchResult {
  accommodations: AcmdJanAccommodation[];
  total: number;
  limit: number;
  offset: number;
}

// ---------------------------------------------------------------------------
// ILIKE Escape
// ---------------------------------------------------------------------------

/**
 * Escape special ILIKE characters (%, _, \) in user input.
 * Prevents users from injecting wildcards into search patterns.
 */
export function escapeIlike(input: string): string {
  return input
    .replace(/\\/g, '\\\\') // must be first — escape backslash itself
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/**
 * Search JAN accommodations by condition and/or job category.
 * Case-insensitive partial match using ILIKE.
 *
 * @param options - Search filters + pagination
 * @returns Matching accommodations with total count
 */
export async function searchJanAccommodations(
  options: JanSearchOptions,
): Promise<JanSearchResult> {
  const limit = options.limit ?? 20;
  const offset = options.offset ?? 0;

  // Build WHERE conditions
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const conditions: any[] = [];

  if (options.condition) {
    conditions.push(
      ilike(acmdJanAccommodations.condition, `%${escapeIlike(options.condition)}%`),
    );
  }

  if (options.job) {
    conditions.push(
      ilike(acmdJanAccommodations.jobCategory, `%${escapeIlike(options.job)}%`),
    );
  }

  const whereClause = conditions.length === 0
    ? undefined
    : conditions.length === 1
      ? conditions[0]
      : and(...conditions);

  // Count total
  const countQuery = db
    .select({ count: sql<number>`count(*)::int` })
    .from(acmdJanAccommodations);

  const [countResult] = whereClause
    ? await countQuery.where(whereClause)
    : await countQuery;

  const total = countResult?.count ?? 0;

  // Fetch paginated results
  const dataQuery = db
    .select()
    .from(acmdJanAccommodations);

  const rows = whereClause
    ? await dataQuery.where(whereClause).limit(limit).offset(offset)
    : await dataQuery.limit(limit).offset(offset);

  return {
    accommodations: rows as AcmdJanAccommodation[],
    total,
    limit,
    offset,
  };
}

/**
 * Fallback search: find JAN accommodations matching case condition + job.
 * Used when AI suggestion fails. Returns up to 5 results sorted by effectiveness.
 */
export async function fallbackJanSearch(
  condition: string,
  jobCategory?: string | null,
): Promise<AcmdJanAccommodation[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const conditions: any[] = [
    ilike(acmdJanAccommodations.condition, `%${escapeIlike(condition)}%`),
  ];

  if (jobCategory) {
    conditions.push(
      or(
        ilike(acmdJanAccommodations.jobCategory, `%${escapeIlike(jobCategory)}%`),
        // Also match records with null job_category (universal accommodations)
        sql`${acmdJanAccommodations.jobCategory} IS NULL`,
      ),
    );
  }

  const whereClause = conditions.length === 1
    ? conditions[0]
    : and(...conditions);

  const rows = await db
    .select()
    .from(acmdJanAccommodations)
    .where(whereClause)
    .limit(5);

  return rows as AcmdJanAccommodation[];
}
