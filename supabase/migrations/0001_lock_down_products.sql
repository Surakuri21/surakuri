-- ============================================================================
-- Migration 0001 — Lock down public.products (Supabase)
-- ============================================================================
-- WHY THIS EXISTS
--   Verified on 2026-10-05 with the browser-shipped anon key:
--     * GET    /rest/v1/products  -> HTTP 200 (rows readable)
--     * PATCH  /rest/v1/products  -> HTTP 200 (anon could UPDATE rows)
--     * DELETE /rest/v1/products  -> HTTP 204 (anon could DELETE rows)
--   The exposed rows also contained `cost_price` (margin data), which
--   SURAKURI's rules classify as "never expose" (inventory cost).
--
--   Root cause: the table was readable/writable by the `anon` and
--   `authenticated` roles — the two roles whose keys are safe to ship to a
--   browser. Any visitor could rewrite or erase the catalog mirror.
--
-- TARGET ARCHITECTURE (decided 2026-10-05)
--   The storefront reads catalog data through server-side BFF routes ONLY.
--   The browser never holds a Supabase key. Therefore `anon` and
--   `authenticated` need NO privileges on this table at all.
--   Only the server-side `service_role` (used by the IMS -> Supabase sync and
--   by the BFF) may read/write it.
--
-- SAFE ORDERING (important — read before running)
--   Step 1 (this file): close the exposure.
--   Step 2: deploy the IMS change that stops sending `cost_price`. (DONE in
--           includes/supabase.php + actions/products/{create,update}.php)
--   Step 3 (migration 0002, later): DROP the column entirely.
--
-- VERIFIED (empirical, 2026-10-05): `cost_price` is ALREADY NULLABLE in the
-- live database. A probe INSERT that omitted the column returned HTTP 201, and
-- the probe row was deleted afterwards. PostgREST's OpenAPI document lists
-- `cost_price` under `required`, but that metadata is NOT authoritative — only
-- the live insert is. The `drop not null` below is therefore defensive and
-- idempotent, and removing `cost_price` from the PHP payload does not break
-- upserts. Trust the probe, not the generated spec.
--
-- IDEMPOTENT: safe to re-run.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. Enable Row Level Security (deny-by-default once no permissive policy exists)
-- ----------------------------------------------------------------------------
alter table public.products enable row level security;

-- `force` makes RLS apply even to the table owner, closing the
-- "owner silently bypasses policy" gap.
alter table public.products force row level security;

-- ----------------------------------------------------------------------------
-- 2. Drop EVERY existing policy on this table
--    Enumerated from the catalog rather than guessed by name, so unknown or
--    future permissive policies cannot survive this migration.
-- ----------------------------------------------------------------------------
do $$
declare
    pol record;
begin
    for pol in
        select policyname
        from pg_policies
        where schemaname = 'public'
          and tablename  = 'products'
    loop
        execute format('drop policy if exists %I on public.products', pol.policyname);
        raise notice 'Dropped policy %.%', 'products', pol.policyname;
    end loop;
end
$$;

-- ----------------------------------------------------------------------------
-- 3. Revoke table privileges from the browser-facing roles
--    RLS alone is not enough: privileges and policies are independent gates.
--    `service_role` is deliberately left untouched (server-side only).
-- ----------------------------------------------------------------------------
revoke all on table public.products from anon;
revoke all on table public.products from authenticated;

-- Sequence privilege as well, so a future insert cannot advance the id sequence.
do $$
begin
    if exists (
        select 1 from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'S'
          and c.relname = pg_get_serial_sequence('public.products', 'id')
    ) then
        execute format(
            'revoke all on sequence %s from anon, authenticated',
            pg_get_serial_sequence('public.products', 'id')
        );
    end if;
end
$$;

-- ----------------------------------------------------------------------------
-- 4. Defensive: ensure cost_price is nullable.
--    Verified already nullable (see SAFE ORDERING); kept so this migration is
--    self-sufficient on a fresh project where it might not be.
--    Column is dropped in migration 0002.
-- ----------------------------------------------------------------------------
alter table public.products alter column cost_price drop not null;

-- ----------------------------------------------------------------------------
-- 5. Protect tables created in future
--    Supabase grants browser roles access to newly created public tables by
--    default. Revoking the default privileges means a future `public.orders`
--    is NOT world-readable the moment it is created. Explicit grants then
--    become a deliberate, reviewable act.
-- ----------------------------------------------------------------------------
alter default privileges in schema public
    revoke all on tables from anon, authenticated;
alter default privileges in schema public
    revoke all on sequences from anon, authenticated;

commit;

-- ============================================================================
-- VERIFICATION (run after applying)
-- ============================================================================
-- Expect: zero rows -> no permissive policies remain.
--   select policyname, roles, cmd, qual
--   from pg_policies
--   where schemaname = 'public' and tablename = 'products';
--
-- Expect: no rows for anon/authenticated.
--   select grantee, privilege_type
--   from information_schema.role_table_grants
--   where table_schema = 'public' and table_name = 'products'
--     and grantee in ('anon', 'authenticated');
--
-- Then re-run the attack probes with the anon key and confirm:
--   GET    /rest/v1/products -> 401/403 (no longer 200)
--   PATCH  /rest/v1/products -> 401/403 (no longer 200)
--   DELETE /rest/v1/products -> 401/403 (no longer 204)
--   And confirm the service key still works (the IMS sync must not break).

-- ============================================================================
-- ROLLBACK (only if the storefront genuinely needs direct browser reads)
-- ============================================================================
-- begin;
--   drop policy if exists products_service_all on public.products;
--   create policy products_public_read on public.products
--       for select to anon, authenticated using (is_active = true);
--   grant select on table public.products to anon, authenticated;
-- commit;
-- NOTE: any rollback must never re-expose cost_price. Drop the column first.