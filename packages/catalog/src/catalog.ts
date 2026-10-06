/**
 * Catalog shaping — mirror rows to storefront-safe items.
 *
 * The Supabase `public.products` mirror carries only what the IMS
 * sync writes (sku, name, DECIMAL price, quantity, category,
 * supplier, flags). Notably absent: UUIDs, brand/model splits,
 * condition, images. This module shapes exactly what exists into a
 * strict, cost-free item — it does NOT invent the missing editorial
 * fields. Enrichment to `ProductListItemSchema` (brand/model/
 * reference split, imagery, condition) awaits editorial data (Phase 2+)
 * and must never be guessed from `name`.
 *
 * Safety is structural: the output object is constructed field by
 * field, so even a mirror row leaking `cost_price` cannot flow
 * through (locked by test).
 */

import { z } from "zod";
import { MoneySchema } from "@surakuri/contracts";
import {
  availableQuantity,
  decimalToMinorUnits,
  skuToSlug,
} from "@surakuri/ims-adapter";
import type { ImsProductRow } from "@surakuri/ims-adapter";

/** Storefront-safe catalog item. Strict: unknown fields rejected. */
export const CatalogItemSchema = z
  .object({
    slug: z.string().min(1).max(120),
    name: z.string().min(1),
    price: MoneySchema,
    inStock: z.boolean(),
    category: z.string().nullable(),
  })
  .strict();

export type CatalogItem = z.infer<typeof CatalogItemSchema>;

export const CatalogListResponseSchema = z.object({
  items: z.array(CatalogItemSchema),
  /** Opaque v0 cursor: the last item's slug. UUID cursors arrive with editorial IDs. */
  nextCursor: z.string().nullable(),
});

export type CatalogListResponse = z.infer<typeof CatalogListResponseSchema>;

/**
 * Shapes one mirror row. Throws on bad prices or empty names —
 * a corrupt row must fail the read, never render a wrong price.
 */
export function shapeCatalogItem(row: ImsProductRow): CatalogItem {
  return CatalogItemSchema.parse({
    slug: skuToSlug(row.sku),
    name: row.name,
    price: {
      amount_minor: decimalToMinorUnits(row.unit_price),
      currency: "USD",
    },
    inStock: row.is_active && availableQuantity(row.quantity) > 0,
    category: row.category_name,
  });
}

export function toListResponse(
  items: readonly CatalogItem[],
  nextCursor: string | null,
): CatalogListResponse {
  return CatalogListResponseSchema.parse({ items: [...items], nextCursor });
}
