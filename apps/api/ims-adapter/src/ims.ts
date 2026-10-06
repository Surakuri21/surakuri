/**
 * IMS boundary — the ONLY module that may know IMS shapes.
 *
 * Ownership (§8): the IMS owns physical reality (SKU + quantity +
 * DECIMAL cost/price). This adapter translates at the boundary:
 * DECIMAL strings become integer minor units (via `parseDecimal`,
 * which refuses to silently round), `sku` maps to the storefront
 * `slug`, and the Supabase mirror payload NEVER contains `cost_price`
 * (§60, ADR 0003).
 *
 * Assumptions (IMS reality, verified in `database.sql`):
 * - `unit_price` arrives as a DECIMAL *string* (mysql2 default).
 *   A JS number here has already lost information — rejected.
 * - The IMS is single-currency (USD) until `packages/pricing/` owns
 *   multi-currency. The currency parameter exists for that future.
 * - Stock below zero means oversold: the storefront projection clamps
 *   to 0 (fail closed — blocks the sale instead of showing phantom
 *   stock), while the raw value stays visible to admin/reconciliation.
 */

import { parseDecimal } from "@surakuri/money";
import type { CurrencyCode } from "@surakuri/money";

/** One row of the IMS `products` table (subset the storefront needs). */
export interface ImsProductRow {
  readonly mysql_id: number;
  readonly sku: string;
  readonly name: string;
  /** DECIMAL(10,2) as a string, e.g. "12500.00". Never a float. */
  readonly unit_price: string;
  readonly quantity: number;
  readonly category_name: string | null;
  readonly supplier_name: string | null;
  readonly is_active: boolean;
  readonly synced_at: string;
}

/**
 * Supabase `public.products` mirror payload.
 * Deliberately has NO `cost_price` field — it cannot be sent by
 * construction, not just by convention.
 */
export interface SupabaseMirrorPayload {
  readonly mysql_id: number;
  readonly sku: string;
  readonly slug: string;
  readonly name: string;
  readonly unit_price: string;
  readonly quantity: number;
  readonly category_name: string | null;
  readonly supplier_name: string | null;
  readonly is_active: boolean;
  readonly synced_at: string;
}

/**
 * Absorbs the `product_slug` ↔ `sku` naming mismatch: the webhook
 * speaks slugs, the IMS speaks SKUs. The storefront only ever sees
 * slugs. Mapping is one-directional (slug → SKU requires a lookup
 * against live data, owned by the sync service, not this pure module).
 */
export function skuToSlug(sku: string): string {
  const slug = sku
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug.length === 0) {
    throw new Error(`Cannot derive a slug from SKU ${JSON.stringify(sku)}.`);
  }
  return slug;
}

/** DECIMAL string → integer minor units. Throws instead of rounding. */
export function decimalToMinorUnits(
  unitPrice: string,
  currency: CurrencyCode = "USD",
): number {
  if (typeof unitPrice !== "string") {
    throw new Error(
      `unit_price must be a DECIMAL string, received ${typeof unitPrice}. ` +
        "A JS number has already lost precision.",
    );
  }
  return parseDecimal(unitPrice, currency).amountMinor;
}

/** Builds the mirror payload. `cost_price` cannot be expressed here. */
export function toMirrorPayload(row: ImsProductRow): SupabaseMirrorPayload {
  return {
    mysql_id: row.mysql_id,
    sku: row.sku,
    slug: skuToSlug(row.sku),
    name: row.name,
    unit_price: row.unit_price,
    quantity: row.quantity,
    category_name: row.category_name,
    supplier_name: row.supplier_name,
    is_active: row.is_active,
    synced_at: row.synced_at,
  };
}

/** Storefront availability projection. Negative stock reads as 0. */
export function availableQuantity(quantity: number): number {
  return Math.max(0, Math.floor(quantity));
}
