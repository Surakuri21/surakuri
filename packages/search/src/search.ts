/**
 * Product search query builder (PostgreSQL full-text + pg_trgm).
 *
 * The query text is FIXED — user input only ever travels in `values`
 * as bound parameters ($1..$4). There is no code path where input
 * touches the SQL string (locked by test).
 *
 * Ranking: full-text rank first, trigram similarity second, so exact
 * name/SKU matches outrank fuzzy ones. Live requirements (Phase 2 DB
 * work, owner-side): `pg_trgm` extension installed, GIN index on the
 * tsvector expression, migration 0001 applied so reads are safe.
 */

export interface ProductSearchQuery {
  readonly text: string;
  readonly values: readonly [string, string, number, number];
}

export interface SearchOptions {
  readonly limit?: number | undefined;
  readonly similarity?: number | undefined;
}

const MAX_QUERY_LENGTH = 200;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const DEFAULT_SIMILARITY = 0.3;

const SEARCH_SQL = [
  "SELECT sku, name FROM public.products",
  "WHERE is_active = TRUE",
  "AND (to_tsvector('english', name || ' ' || sku) @@ plainto_tsquery('english', $1)",
  "OR similarity(name, $2) > $3)",
  "ORDER BY ts_rank(to_tsvector('english', name || ' ' || sku), plainto_tsquery('english', $1)) DESC,",
  "similarity(name, $2) DESC",
  "LIMIT $4",
].join(" ");

export function buildProductSearch(
  rawQuery: string,
  options: SearchOptions = {},
): ProductSearchQuery {
  const normalized = rawQuery.trim().replace(/\s+/g, " ");
  if (normalized.length === 0) {
    throw new Error("Search query must not be empty.");
  }
  if (normalized.length > MAX_QUERY_LENGTH) {
    throw new Error(
      `Search query exceeds ${MAX_QUERY_LENGTH} characters.`,
    );
  }
  const similarity = options.similarity ?? DEFAULT_SIMILARITY;
  if (!Number.isFinite(similarity) || similarity < 0 || similarity > 1) {
    throw new Error("Similarity must be a number between 0 and 1.");
  }
  const requested = Math.floor(options.limit ?? DEFAULT_LIMIT);
  const limit = Math.min(Math.max(requested, 1), MAX_LIMIT);
  return { text: SEARCH_SQL, values: [normalized, normalized, similarity, limit] };
}
