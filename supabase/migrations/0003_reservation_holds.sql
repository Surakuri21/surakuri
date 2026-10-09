-- ============================================================================
-- Migration 0003 — reservation holds table (Supabase)
-- ============================================================================
-- WHY public schema, not reservation.*:
--   Hosted Supabase exposes ONLY the `public` (and `storage`) schemas
--   through PostgREST, which is the only API supabase-js speaks.
--   Domain separation is therefore enforced by table naming + RLS,
--   not by Postgres schemas. 0002 is reserved for the cost_price drop.
--
-- POSTURE (same as 0001): deny-by-default. RLS enabled + forced, no
-- policies, all privileges revoked from anon/authenticated. Only
-- service_role (server-side BFF) can read/write.
--
-- IDEMPOTENT: safe to re-run.
-- ============================================================================

begin;

create table if not exists public.reservation_holds (
  id              uuid primary key,
  customer_id     uuid not null,
  slug            text not null,
  quantity        integer not null check (quantity > 0),
  idempotency_key text not null unique,
  state           text not null
                    check (state in ('active', 'expired', 'committed', 'cancelled')),
  expires_at      timestamptz not null,
  created_at      timestamptz not null
);

create index if not exists reservation_holds_active_idx
  on public.reservation_holds (slug, expires_at)
  where state = 'active';

alter table public.reservation_holds enable row level security;
alter table public.reservation_holds force row level security;

do $$
declare
    pol record;
begin
    for pol in
        select policyname
        from pg_policies
        where schemaname = 'public'
          and tablename  = 'reservation_holds'
    loop
        execute format('drop policy if exists %I on public.reservation_holds', pol.policyname);
        raise notice 'Dropped policy %.%', 'reservation_holds', pol.policyname;
    end loop;
end
$$;

revoke all on table public.reservation_holds from anon;
revoke all on table public.reservation_holds from authenticated;

commit;

-- ============================================================================
-- VERIFICATION (run after applying)
-- ============================================================================
-- Expect: zero rows (no permissive policies).
--   select policyname, roles, cmd from pg_policies
--   where schemaname = 'public' and tablename = 'reservation_holds';
--
-- Expect: no rows for anon/authenticated.
--   select grantee, privilege_type
--   from information_schema.role_table_grants
--   where table_schema = 'public' and table_name = 'reservation_holds'
--     and grantee in ('anon', 'authenticated');
