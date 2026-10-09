/**
 * Supabase-backed order store (`public.shop_orders`).
 * Same contract as the dev memory store. Corrupt rows throw —
 * an order must never silently change shape between writes.
 * Requires migration 0004 applied (owner-side, SQL Editor).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { OrderItemSchema, OrderRecordSchema } from "./order.js";
import type { OrderRecord, OrderStore } from "./order.js";

const OrderRowSchema = z.object({
  id: z.string().uuid(),
  customer_id: z.string().uuid(),
  reservation_id: z.string().uuid(),
  items: z.array(OrderItemSchema),
  total_minor: z.number().int(),
  currency: z.string(),
  idempotency_key: z.string(),
  state: z.enum([
    "draft",
    "pending_payment",
    "paid",
    "reserved",
    "in_fulfilment",
    "shipped",
    "delivered",
    "cancelled",
    "expired",
  ]),
  payment_ref: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

function toRecord(row: z.infer<typeof OrderRowSchema>): OrderRecord {
  return OrderRecordSchema.parse({
    id: row.id,
    customerId: row.customer_id,
    reservationId: row.reservation_id,
    items: row.items,
    totalMinor: row.total_minor,
    currency: row.currency,
    idempotencyKey: row.idempotency_key,
    state: row.state,
    ...(row.payment_ref === null ? {} : { paymentRef: row.payment_ref }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function toRow(record: OrderRecord): Record<string, unknown> {
  return {
    id: record.id,
    customer_id: record.customerId,
    reservation_id: record.reservationId,
    items: record.items,
    total_minor: record.totalMinor,
    currency: record.currency,
    idempotency_key: record.idempotencyKey,
    state: record.state,
    payment_ref: record.paymentRef ?? null,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
  };
}

export function createSupabaseOrderStore(client: SupabaseClient): OrderStore {
  return {
    findByKey: async (key) => {
      const { data, error } = await client
        .from("shop_orders")
        .select("*")
        .eq("idempotency_key", key)
        .maybeSingle();
      if (error !== null) {
        throw new Error(`orders read failed: ${error.message}`);
      }
      if (data === null) return undefined;
      return toRecord(OrderRowSchema.parse(data));
    },
    getById: async (id) => {
      const { data, error } = await client
        .from("shop_orders")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error !== null) {
        throw new Error(`orders read failed: ${error.message}`);
      }
      if (data === null) return undefined;
      return toRecord(OrderRowSchema.parse(data));
    },
    listStalePending: async (cutoffIso) => {
      const { data, error } = await client
        .from("shop_orders")
        .select("*")
        .eq("state", "pending_payment")
        .lte("created_at", cutoffIso);
      if (error !== null) {
        throw new Error(`orders read failed: ${error.message}`);
      }
      return (data ?? []).map((row) => toRecord(OrderRowSchema.parse(row)));
    },
    insert: async (record) => {
      const { error } = await client.from("shop_orders").insert(toRow(record));
      if (error !== null) {
        throw new Error(`orders insert failed: ${error.message}`);
      }
    },
    update: async (record) => {
      const { error } = await client
        .from("shop_orders")
        .update(toRow(record))
        .eq("id", record.id);
      if (error !== null) {
        throw new Error(`orders update failed: ${error.message}`);
      }
    },
  };
}
