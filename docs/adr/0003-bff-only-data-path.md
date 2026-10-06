# ADR 0003 — BFF-only data path; no browser Supabase key

Status: accepted (2026-10-06). Source: DEC-03 (§60, §61).

## Context

Verified 2026-10-05 with read-only probes: the `anon` key could SELECT
(full rows including `cost_price`), UPDATE (HTTP 200), and DELETE
(HTTP 204) the `public.products` mirror. `cost_price` is inventory cost —
a §60 "never expose" item.

## Decision

The browser never holds any Supabase key. All catalog reads go through
server-side `core-api` BFF routes (`/api/v1/products/*`) that resolve the
session, apply timeouts, shape safe responses (no `cost_price`, masked
serials per §50), and enforce `no-store` on personalised routes (§54, §55,
§61). Migration `0001_lock_down_products.sql` revokes all privileges from
`anon`/`authenticated`, enables RLS, and closes future tables via default
privileges; `service_role` is used server-side only.

## Consequences

- Slightly more server round-trips than direct browser reads; eliminates
  every client-side exposure of cost, internal IDs, and supplier details.
- `packages/contracts/src/index.ts` defines `ProductListItemSchema` with
  no cost-price field as the shape contract.
- Blocker (owner-only): migration 0001 must be applied via the Supabase
  SQL Editor before any catalog/BFF work goes live.
