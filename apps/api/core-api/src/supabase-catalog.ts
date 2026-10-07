/**
 * Live Supabase catalog source (service-role, server-only).
 *
 * Post-0001 reality: `anon`/`authenticated` can no longer
 * touch `public.products`; ONLY `service_role` can read the
 * mirror. This module runs exclusively inside core-api, so the
 * browser never sees the key (ADR 0003).
 *
 * Pagination is keyset over `sku` (unique in the mirror), so
 * cursors are the last row's SKU — stable across inserts,
 * unlike OFFSET. The cursor is opaque to clients; it is never
 * a raw SQL value (bound or interpolated).
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { ImsProductRow } from "@surakuri/ims-adapter";
import { shapeCatalogItem } from "@surakuri/catalog";
import type { CatalogItem, CatalogListResponse } from "@surakuri/catalog";
import { CatalogListResponseSchema } from "@surakuri/catalog";

/**
 * Mirror row subset needed for the catalog projection.
 * PostgREST returns NUMERIC as JSON numbers, so `unit_price`
 * arrives as a number; it is normalized to a DECIMAL string
 * before shaping (exact for DECIMAL(10,2) magnitudes — never
 * a float computation, only a change of notation).
 */
const MirrorRowSchema = z.object({
  mysql_id: z.number().int(),
  sku: z.string().min(1),
  name: z.string().min(1),
  unit_price: z.union([z.string(), z.number()]).transform((value) => String(value)),
  quantity: z.number().int(),
  category_name: z.string().nullable(),
  supplier_name: z.string().nullable(),
  is_active: z.boolean(),
  synced_at: z.string(),
});

export interface SupabaseConfig {
  readonly url: string;
  readonly serviceRoleKey: string;
}

export interface SupabaseCatalogSourceArgs {
  readonly client: SupabaseClient;
}

export interface SupabaseCatalogSource {
  listItems(args: {
    readonly limit: number;
    readonly cursor: string | null;
  }): Promise<CatalogListResponse>;
}

/**
 * Builds the live source. Reads `public.products` ordered by
 * `sku`, applying the cursor as `sku > cursor` (keyset).
 * Rows that fail validation are skipped with no silent price
 * changes — a corrupt row must never reach a storefront.
 */
export function createSupabaseCatalogSource(
  args: SupabaseCatalogSourceArgs,
): SupabaseCatalogSource {
  return {
    async listItems({ limit, cursor }) {
      const effectiveLimit = Math.min(Math.max(Math.floor(limit), 1), 50);
      let query = args.client
        .from("products")
        .select(
          "mysql_id, sku, name, unit_price, quantity, category_name, supplier_name, is_active, synced_at",
        )
        .order("sku", { ascending: true })
        .limit(effectiveLimit + 1);
      if (cursor !== null) {
        query = query.gt("sku", cursor);
      }
      const { data, error } = await query;
      if (error !== null) {
        throw new Error(`Supabase read failed: ${error.message}`);
      }
      const parsedRows = (data ?? []).map((row) =>
        MirrorRowSchema.safeParse(row),
      );
      const validRows = parsedRows
        .map((result) => (result.success ? result.data : undefined))
        .filter((row): row is ImsProductRow => row !== undefined);
      const hasNext = validRows.length > effectiveLimit;
      const pageRows = hasNext ? validRows.slice(0, effectiveLimit) : validRows;
      const items: CatalogItem[] = [];
      let lastSku: string | null = null;
      for (const row of pageRows) {
        lastSku = row.sku;
        try {
          items.push(shapeCatalogItem(row));
        } catch {
          // Corrupt row (bad price/name): drop from the page.
        }
      }
      const nextCursor = hasNext && lastSku !== null ? lastSku : null;
      return CatalogListResponseSchema.parse({ items, nextCursor });
    },
  };
}

export function liveSupabaseSource(
  config: SupabaseConfig,
): SupabaseCatalogSource {
  const client = createClient(config.url, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: { "x-surakuri-service": "core-api" },
    },
  });
  return createSupabaseCatalogSource({ client });
}
