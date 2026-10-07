/**
 * Order state machine (§17).
 *
 * draft → pending_payment → paid → reserved → in_fulfilment
 *   → shipped → delivered, with cancelled/expired exits.
 *
 * Every transition is validated against the map below — an illegal
 * jump throws instead of writing a corrupt row. Payment capture
 * (`pending_payment` → `paid`) requires a gateway reference that
 * only the Stripe webhook slice may supply; until then orders park
 * at `pending_payment` and no route exposes `markPaid`.
 */

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { IdSchema } from "@surakuri/contracts";

export const OrderState = z.enum([
  "draft",
  "pending_payment",
  "paid",
  "reserved",
  "in_fulfilment",
  "shipped",
  "delivered",
  "cancelled",
  "expired",
]);

export type OrderState = z.infer<typeof OrderState>;

const TRANSITIONS: Record<OrderState, readonly OrderState[]> = {
  draft: ["pending_payment", "cancelled"],
  pending_payment: ["paid", "cancelled", "expired"],
  paid: ["reserved", "cancelled"],
  reserved: ["in_fulfilment", "cancelled"],
  in_fulfilment: ["shipped"],
  shipped: ["delivered"],
  delivered: [],
  cancelled: [],
  expired: [],
};

export const OrderItemSchema = z
  .object({
    slug: z.string().min(1),
    quantity: z.number().int().positive(),
    unitMinor: z.number().int().nonnegative(),
  })
  .strict();

export const OrderRecordSchema = z
  .object({
    id: IdSchema,
    customerId: IdSchema,
    reservationId: IdSchema,
    items: z.array(OrderItemSchema).min(1),
    totalMinor: z.number().int().nonnegative(),
    currency: z.string().length(3),
    idempotencyKey: z.string().min(1),
    state: OrderState,
    paymentRef: z.string().min(1).optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export type OrderRecord = z.infer<typeof OrderRecordSchema>;

export type OrderFailure =
  | "conflict"
  | "not-found"
  | "invalid-transition"
  | "missing-payment-ref";

export class OrderError extends Error {
  public readonly code: OrderFailure;

  public constructor(code: OrderFailure, message: string) {
    super(message);
    this.name = "OrderError";
    this.code = code;
  }
}

export interface CreateOrderInput {
  readonly customerId: string;
  readonly reservationId: string;
  readonly items: readonly {
    readonly slug: string;
    readonly quantity: number;
    readonly unitMinor: number;
  }[];
  readonly currency: string;
  readonly idempotencyKey: string;
}

export interface OrderStore {
  findByKey(idempotencyKey: string): OrderRecord | undefined;
  getById(id: string): OrderRecord | undefined;
  listStalePending(nowIso: string): OrderRecord[];
  insert(record: OrderRecord): void;
  update(record: OrderRecord): void;
}

function stamp(record: OrderRecord, nowIso: string): OrderRecord {
  return { ...record, updatedAt: nowIso };
}

export function createOrder(
  store: OrderStore,
  input: CreateOrderInput,
  now: Date,
): OrderRecord {
  const existing = store.findByKey(input.idempotencyKey);
  if (existing !== undefined) {
    const same =
      existing.customerId === input.customerId &&
      existing.reservationId === input.reservationId &&
      existing.currency === input.currency &&
      existing.items.length === input.items.length &&
      existing.items.every(
        (line, i) =>
          line.slug === input.items[i]?.slug &&
          line.quantity === input.items[i]?.quantity &&
          line.unitMinor === input.items[i]?.unitMinor,
      );
    if (!same) {
      throw new OrderError(
        "conflict",
        "Idempotency key was already used for a different order.",
      );
    }
    return existing;
  }
  const nowIso = now.toISOString();
  const totalMinor = input.items.reduce(
    (total, line) => total + line.quantity * line.unitMinor,
    0,
  );
  const record = OrderRecordSchema.parse({
    id: randomUUID(),
    customerId: input.customerId,
    reservationId: input.reservationId,
    items: [...input.items],
    totalMinor,
    currency: input.currency,
    idempotencyKey: input.idempotencyKey,
    state: "draft",
    createdAt: nowIso,
    updatedAt: nowIso,
  });
  store.insert(record);
  return record;
}

export function transition(
  store: OrderStore,
  id: string,
  to: OrderState,
  now: Date,
  options: { readonly paymentRef?: string | undefined } = {},
): OrderRecord {
  const record = store.getById(id);
  if (record === undefined) {
    throw new OrderError("not-found", "Order does not exist.");
  }
  if (!TRANSITIONS[record.state].includes(to)) {
    throw new OrderError(
      "invalid-transition",
      `Cannot move order from ${record.state} to ${to}.`,
    );
  }
  if (to === "paid" && options.paymentRef === undefined) {
    throw new OrderError(
      "missing-payment-ref",
      "Paid state requires a gateway payment reference.",
    );
  }
  const updated: OrderRecord = stamp(
    {
      ...record,
      state: to,
      ...(options.paymentRef === undefined
        ? {}
        : { paymentRef: options.paymentRef }),
    },
    now.toISOString(),
  );
  store.update(updated);
  return updated;
}

/** Moves stale `pending_payment` orders to `expired`. Returns the count. */
export function sweepOrders(store: OrderStore, now: Date, olderThanMinutes = 60): number {
  const cutoff = new Date(now.getTime() - olderThanMinutes * 60_000).toISOString();
  let expired = 0;
  for (const record of store.listStalePending(cutoff)) {
    store.update(stamp({ ...record, state: "expired" }, now.toISOString()));
    expired += 1;
  }
  return expired;
}
