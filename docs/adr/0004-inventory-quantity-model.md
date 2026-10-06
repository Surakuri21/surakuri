# ADR 0004 — Inventory: SKU-quantity now; serialized units later

Status: accepted (2026-10-06). Source: DEC-02, DEC-06 (§3, §12, §15).

## Context

The IMS (`database.sql`) models `products` with unique `sku` + `quantity`
INT and no `serial_number`, `reference_number`, `condition`, `box`,
`papers`, `provenance`, or `service_history`. The master prompt assumes
1-of-1 serialized units (§12 partial-unique-index on `unit_id`, §15
`/units/{serial}/reserve` endpoints) — no IMS substrate exists for either.
Additionally the sync webhook (`api/sync-order.php`) is non-idempotent
(retry = double deduction) and writes `audit_logs` but never a
`transactions` row (reconciliation gap).

## Decision

Phase 0–3 use quantity-based retail matching IMS reality: `packages/cart/`
holds SKU-level quantities; `packages/reservation/` uses an integer
available-quantity guard, not the `one_active_reservation_per_unit`
partial-unique-index. Serialized units arrive later as an additive,
versioned IMS extension (`/api/v1/units/*` per §15, never a rewrite of
existing PHP per §4); the `unit_id` index and `unit_id`-based reservation
migrate then. The storefront must rely on the reservation DB guard, never
on webhook-only deduction.

## Consequences

- `packages/catalog/` and `packages/search/` are SKU-based; the
  `sku`↔`product_slug` naming mismatch is absorbed by `ims-adapter/`,
  never leaked to the storefront.
- Structural risks tracked, not fixed here: IMS has no git history;
  webhook secret needs rotation with fallback removal.
