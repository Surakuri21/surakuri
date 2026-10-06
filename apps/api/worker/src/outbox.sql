-- SURAKURI outbox — REFERENCE DDL (not yet applied).
--
-- A future numbered migration will apply this when the worker service
-- ships (Phase 4). It lives here so the table shape is reviewed and
-- agreed before any code writes to it.
--
-- Rule: domain rows and outbox rows are written in ONE transaction.
-- The worker claims with SELECT ... FOR UPDATE SKIP LOCKED, delivers,
-- then marks done. Delivery may retry; it must never lose an event.

CREATE SCHEMA IF NOT EXISTS audit;

CREATE TABLE IF NOT EXISTS audit.outbox (
  event_id      UUID PRIMARY KEY,
  type          TEXT NOT NULL CHECK (type IN ('order.placed', 'reservation.created', 'reservation.expired')),
  aggregate_id  UUID NOT NULL,
  correlation_id TEXT NOT NULL,
  causation_id  UUID,
  occurred_at   TIMESTAMPTZ NOT NULL,
  payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
  claimed_at    TIMESTAMPTZ,
  attempts      INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS outbox_due_idx
  ON audit.outbox (occurred_at) WHERE claimed_at IS NULL;
