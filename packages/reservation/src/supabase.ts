/**
 * Supabase-backed hold store (`public.reservation_holds`).
 *
 * Same `ReservationStore` contract as the dev memory store, so the
 * guard logic is storage-agnostic. Two deliberate choices:
 * - Corrupt rows THROW instead of being skipped: a hold that
 *   vanishes from the guard could allow an oversell. Fail closed.
 * - Requires migration 0003 applied (owner-side, SQL Editor).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ReservationRecordSchema } from "./reservation.js";
import type { ReservationRecord, ReservationStore } from "./reservation.js";

const HoldRowSchema = z.object({
  id: z.string().uuid(),
  customer_id: z.string().uuid(),
  slug: z.string(),
  quantity: z.number().int(),
  idempotency_key: z.string(),
  state: z.enum(["active", "expired", "committed", "cancelled"]),
  expires_at: z.string(),
  created_at: z.string(),
});

function toRecord(row: z.infer<typeof HoldRowSchema>): ReservationRecord {
  return ReservationRecordSchema.parse({
    id: row.id,
    customerId: row.customer_id,
    slug: row.slug,
    quantity: row.quantity,
    idempotencyKey: row.idempotency_key,
    state: row.state,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  });
}

function toRow(record: ReservationRecord): Record<string, unknown> {
  return {
    id: record.id,
    customer_id: record.customerId,
    slug: record.slug,
    quantity: record.quantity,
    idempotency_key: record.idempotencyKey,
    state: record.state,
    expires_at: record.expiresAt,
    created_at: record.createdAt,
  };
}

export function createSupabaseReservationStore(
  client: SupabaseClient,
): ReservationStore {
  return {
    findByKey: async (key) => {
      const { data, error } = await client
        .from("reservation_holds")
        .select("*")
        .eq("idempotency_key", key)
        .maybeSingle();
      if (error !== null) {
        throw new Error(`holds read failed: ${error.message}`);
      }
      if (data === null) return undefined;
      return toRecord(HoldRowSchema.parse(data));
    },
    getById: async (id) => {
      const { data, error } = await client
        .from("reservation_holds")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error !== null) {
        throw new Error(`holds read failed: ${error.message}`);
      }
      if (data === null) return undefined;
      return toRecord(HoldRowSchema.parse(data));
    },
    listActive: async (nowIso) => {
      const { data, error } = await client
        .from("reservation_holds")
        .select("*")
        .eq("state", "active")
        .gt("expires_at", nowIso);
      if (error !== null) {
        throw new Error(`holds read failed: ${error.message}`);
      }
      return (data ?? []).map((row) => toRecord(HoldRowSchema.parse(row)));
    },
    listAged: async (nowIso) => {
      const { data, error } = await client
        .from("reservation_holds")
        .select("*")
        .eq("state", "active")
        .lte("expires_at", nowIso);
      if (error !== null) {
        throw new Error(`holds read failed: ${error.message}`);
      }
      return (data ?? []).map((row) => toRecord(HoldRowSchema.parse(row)));
    },
    insert: async (record) => {
      const { error } = await client
        .from("reservation_holds")
        .insert(toRow(record));
      if (error !== null) {
        throw new Error(`holds insert failed: ${error.message}`);
      }
    },
    update: async (record) => {
      const { error } = await client
        .from("reservation_holds")
        .update(toRow(record))
        .eq("id", record.id);
      if (error !== null) {
        throw new Error(`holds update failed: ${error.message}`);
      }
    },
  };
}
