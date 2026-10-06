/**
 * Transactional outbox skeleton (§16, §5).
 *
 * Rule: no order-affecting transition is published directly. The
 * service writes the domain row AND the outbox row in one DB
 * transaction; this worker later claims due rows, delivers them,
 * and marks them done. A crash between write and delivery only
 * delays — never loses — the event.
 *
 * This slice owns the envelope shape, the due-claim selection rule,
 * and the reference DDL (`outbox.sql`). Live claiming/delivery
 * against `pgmq`/`pg-boss` lands with the worker service (Phase 4).
 */

import { randomUUID } from "node:crypto";
import { z } from "zod";

export const OutboxEventType = z.enum([
  "order.placed",
  "reservation.created",
  "reservation.expired",
]);

export type OutboxEventType = z.infer<typeof OutboxEventType>;

/** Event envelope. Strict: unknown fields are rejected, not stripped. */
export const OutboxEnvelopeSchema = z
  .object({
    eventId: z.string().uuid(),
    type: OutboxEventType,
    aggregateId: z.string().uuid(),
    correlationId: z.string().min(1),
    causationId: z.string().uuid().optional(),
    occurredAt: z.string().datetime(),
    payload: z.record(z.unknown()),
  })
  .strict();

export type OutboxEnvelope = z.infer<typeof OutboxEnvelopeSchema>;

export interface CreateEnvelopeInput {
  readonly type: OutboxEventType;
  readonly aggregateId: string;
  readonly correlationId: string;
  readonly causationId?: string | undefined;
  readonly payload?: Record<string, unknown> | undefined;
}

export function createEnvelope(input: CreateEnvelopeInput): OutboxEnvelope {
  return OutboxEnvelopeSchema.parse({
    eventId: randomUUID(),
    type: input.type,
    aggregateId: input.aggregateId,
    correlationId: input.correlationId,
    ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
    occurredAt: new Date().toISOString(),
    payload: input.payload ?? {},
  });
}

/** One persisted outbox row (see `outbox.sql` for the table). */
export interface OutboxRecord {
  readonly envelope: OutboxEnvelope;
  readonly claimedAt: string | null;
  readonly attempts: number;
}

/**
 * Selects due rows oldest-first, skipping claimed ones, up to `limit`.
 * Pure function of the row set — the live worker will express the same
 * rule as `SELECT ... FOR UPDATE SKIP LOCKED`.
 */
export function claimDue(
  records: readonly OutboxRecord[],
  now: Date,
  limit: number,
): OutboxRecord[] {
  const nowMs = now.getTime();
  return records
    .filter(
      (record) =>
        record.claimedAt === null &&
        Date.parse(record.envelope.occurredAt) <= nowMs,
    )
    .sort((a, b) =>
      a.envelope.occurredAt < b.envelope.occurredAt ? -1 : 1,
    )
    .slice(0, Math.max(0, limit));
}
