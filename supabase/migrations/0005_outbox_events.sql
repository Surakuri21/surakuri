-- ============================================================================
-- Migration 0005 — outbox events table (Supabase)
-- ============================================================================
-- Applies the reference DDL from apps/api/worker/src/outbox.sql, minus
-- the audit.* schema (same PostgREST exposure constraint as 0003).
-- POSTURE: deny-by-default (RLS enabled + forced, no policies,
-- anon/authenticated revoked). Only service_role reads/writes.
--
-- DELIVERY CONTRACT: workers claim with a two-step read-then-mark
-- (PostgREST cannot do SELECT ... FOR UPDATE SKIP LOCKED). Delivery
-- is therefore at-least-once; consumers MUST stay idempotent
-- (order/reservation creation already are, by idempotency key).
--
-- IDEMPOTENT: safe to re-run.
-- ============================================================================

begin;

create table if not exists public.outbox_events (
  event_id       uuid primary key,
  type           text not null
                   check (type in ('order.placed', 'reservation.created', 'reservation.expired')),
  aggregate_id   uuid not null,
  correlation_id text not null,
  causation_id   uuid,
  occurred_at    timestamptz not null,
  payload        jsonb not null default '{}'::jsonb,
  claimed_at     timestamptz,
  attempts       integer not null default 0,
  created_at     timestamptz not null default now()
);

create index if not exists outbox_events_due_idx
  on public.outbox_events (occurred_at)
  where claimed_at is null;

alter table public.outbox_events enable row level security;
alter table public.outbox_events force row level security;

do $$
declare
    pol record;
begin
    for pol in
        select policyname
        from pg_policies
        where schemaname = 'public'
          and tablename  = 'outbox_events'
    loop
        execute format('drop policy if exists %I on public.outbox_events', pol.policyname);
        raise notice 'Dropped policy %.%', 'outbox_events', pol.policyname;
    end loop;
end
$$;

revoke all on table public.outbox_events from anon;
revoke all on table public.outbox_events from authenticated;

commit;

-- ============================================================================
-- VERIFICATION (run after applying)
-- ============================================================================
-- Expect: zero rows (no permissive policies).
--   select policyname, roles, cmd from pg_policies
--   where schemaname = 'public' and tablename = 'outbox_events';
--
-- Expect: no rows for anon/authenticated.
--   select grantee, privilege_type
--   from information_schema.role_table_grants
--   where table_schema = 'public' and table_name = 'outbox_events'
--     and grantee in ('anon', 'authenticated');
