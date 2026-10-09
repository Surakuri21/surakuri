/**
 * Supabase-backed outbox sink (`public.outbox_events`).
 *
 * Best-effort two-step claim (read due, then mark) because
 * PostgREST cannot do SELECT ... FOR UPDATE SKIP LOCKED.
 * Delivery is therefore at-least-once; consumers stay
 * idempotent (order/reservation creation already are).
 * Requires migration 0005 applied (owner-side, SQL Editor).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { OutboxEnvelopeSchema } from "./outbox.js";
import type { OutboxEnvelope, OutboxRecord } from "./outbox.js";

const OutboxRowSchema = z.object({
  event_id: z.string().uuid(),
  type: z.enum(["order.placed", "reservation.created", "reservation.expired"]),
  aggregate_id: z.string().uuid(),
  correlation_id: z.string(),
  causation_id: z.string().uuid().nullable(),
  occurred_at: z.string(),
  payload: z.record(z.unknown()),
  claimed_at: z.string().nullable(),
  attempts: z.number().int(),
});

function toRecord(row: z.infer<typeof OutboxRowSchema>): OutboxRecord {
  const envelope: OutboxEnvelope = OutboxEnvelopeSchema.parse({
    eventId: row.event_id,
    type: row.type,
    aggregateId: row.aggregate_id,
    correlationId: row.correlation_id,
    ...(row.causation_id === null ? {} : { causationId: row.causation_id }),
    occurredAt: row.occurred_at,
    payload: row.payload,
  });
  return { envelope, claimedAt: row.claimed_at, attempts: row.attempts };
}

export interface OutboxSink {
  publish(event: OutboxEnvelope): Promise<void>;
  listDue(nowIso: string, limit: number): Promise<OutboxRecord[]>;
  markClaimed(eventId: string, attempts: number, nowIso: string): Promise<void>;
  markDone(eventId: string): Promise<void>;
}

export function createSupabaseOutboxSink(client: SupabaseClient): OutboxSink {
  const table = () => client.from("outbox_events");
  return {
    publish: async (event) => {
      const { error } = (await table().insert({
        event_id: event.eventId,
        type: event.type,
        aggregate_id: event.aggregateId,
        correlation_id: event.correlationId,
        causation_id: event.causationId ?? null,
        occurred_at: event.occurredAt,
        payload: event.payload,
      })) as { error: { message: string } | null };
      if (error !== null) {
        throw new Error(`outbox publish failed: ${error.message}`);
      }
    },
    listDue: async (nowIso, limit) => {
      const response = (await table()
        .select("*")
        .is("claimed_at", null)
        .lte("occurred_at", nowIso)
        .order("occurred_at", { ascending: true })
        .limit(Math.max(1, Math.floor(limit)))) as {
        data: unknown[] | null;
        error: { message: string } | null;
      };
      if (response.error !== null) {
        throw new Error(`outbox read failed: ${response.error.message}`);
      }
      return (response.data ?? []).map((row) =>
        toRecord(OutboxRowSchema.parse(row)),
      );
    },
    markClaimed: async (eventId, attempts, nowIso) => {
      const { error } = (await table()
        .update({ claimed_at: nowIso, attempts })
        .eq("event_id", eventId)) as { error: { message: string } | null };
      if (error !== null) {
        throw new Error(`outbox claim failed: ${error.message}`);
      }
    },
    markDone: async (eventId) => {
      const { error } = (await table().delete().eq("event_id", eventId)) as {
        error: { message: string } | null;
      };
      if (error !== null) {
        throw new Error(`outbox delete failed: ${error.message}`);
      }
    },
  };
}
