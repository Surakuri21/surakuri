-- ============================================================================
-- Migration 0004 — shop orders table (Supabase)
-- ============================================================================
-- WHY public schema: same PostgREST exposure constraint as 0003.
-- POSTURE: deny-by-default (RLS enabled + forced, no policies,
-- anon/authenticated revoked). Only service_role reads/writes.
--
-- IDEMPOTENT: safe to re-run.
-- ============================================================================

begin;

create table if not exists public.shop_orders (
  id              uuid primary key,
  customer_id     uuid not null,
  reservation_id  uuid not null,
  items           jsonb not null default '[]'::jsonb,
  total_minor     integer not null check (total_minor >= 0),
  currency        text not null,
  idempotency_key text not null unique,
  state           text not null check (state in (
                    'draft', 'pending_payment', 'paid', 'reserved',
                    'in_fulfilment', 'shipped', 'delivered',
                    'cancelled', 'expired'
                  )),
  payment_ref     text,
  created_at      timestamptz not null,
  updated_at      timestamptz not null
);

create index if not exists shop_orders_state_idx
  on public.shop_orders (state, created_at)
  where state = 'pending_payment';

alter table public.shop_orders enable row level security;
alter table public.shop_orders force row level security;

do $$
declare
    pol record;
begin
    for pol in
        select policyname
        from pg_policies
        where schemaname = 'public'
          and tablename  = 'shop_orders'
    loop
        execute format('drop policy if exists %I on public.shop_orders', pol.policyname);
        raise notice 'Dropped policy %.%', 'shop_orders', pol.policyname;
    end loop;
end
$$;

revoke all on table public.shop_orders from anon;
revoke all on table public.shop_orders from authenticated;

commit;

-- ============================================================================
-- VERIFICATION (run after applying)
-- ============================================================================
-- Expect: zero rows (no permissive policies).
--   select policyname, roles, cmd from pg_policies
--   where schemaname = 'public' and tablename = 'shop_orders';
--
-- Expect: no rows for anon/authenticated.
--   select grantee, privilege_type
--   from information_schema.role_table_grants
--   where table_schema = 'public' and table_name = 'shop_orders'
--     and grantee in ('anon', 'authenticated');
