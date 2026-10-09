/**
 * Reservation holds — quantity-guard edition (ADR 0004).
 *
 * The IMS has no serialized units, so the guard is arithmetic, not a
 * partial-unique-index: requested + already-held must not exceed the
 * available quantity the caller passes in. Availability itself comes
 * from the IMS/catalog read path — this module never invents stock.
 *
 * Lifecycle: reserve (TTL 15min default, 30 max) → heartbeat (extends
 * in 15min steps, never past 30min from creation) → committed by
 * checkout, cancelled by the buyer, or expired by the sweeper.
 * Re-POSTs with the same idempotency key return the original hold;
 * the same key with a different payload is a conflict, not a hold.
 */

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { IdSchema } from "@surakuri/contracts";

export const DEFAULT_TTL_MINUTES = 15;
export const MAX_TTL_MINUTES = 30;

export const ReservationRecordSchema = z
  .object({
    id: IdSchema,
    customerId: IdSchema,
    slug: z.string().min(1),
    quantity: z.number().int().positive(),
    idempotencyKey: z.string().min(1),
    state: z.enum(["active", "expired", "committed", "cancelled"]),
    expiresAt: z.string().datetime(),
    createdAt: z.string().datetime(),
  })
  .strict();

export type ReservationRecord = z.infer<typeof ReservationRecordSchema>;

export type ReservationFailure =
  | "insufficient-stock"
  | "conflict"
  | "not-found"
  | "already-settled";

export class ReservationError extends Error {
  public readonly code: ReservationFailure;

  public constructor(code: ReservationFailure, message: string) {
    super(message);
    this.name = "ReservationError";
    this.code = code;
  }
}

export interface HoldInput {
  readonly customerId: string;
  readonly slug: string;
  readonly quantity: number;
  readonly idempotencyKey: string;
}

/**
 * Persistence boundary. Production: Postgres with one row per hold;
 * the serialized-unit partial-unique-index lands here later (ADR 0004).
 */
export interface ReservationStore {
  findByKey(idempotencyKey: string): Promise<ReservationRecord | undefined>;
  getById(id: string): Promise<ReservationRecord | undefined>;
  /** Live holds: active state and not yet expired. Feeds the guard. */
  listActive(nowIso: string): Promise<ReservationRecord[]>;
  /** Overdue holds: still marked active but past expiry. Feeds the sweeper. */
  listAged(nowIso: string): Promise<ReservationRecord[]>;
  insert(record: ReservationRecord): Promise<void>;
  update(record: ReservationRecord): Promise<void>;
}

async function heldForSlug(
  store: ReservationStore,
  slug: string,
  nowIso: string,
): Promise<number> {
  const active = await store.listActive(nowIso);
  return active
    .filter((record) => record.slug === slug)
    .reduce((total, record) => total + record.quantity, 0);
}

export async function reserve(
  store: ReservationStore,
  input: HoldInput,
  available: number,
  now: Date,
  ttlMinutes: number = DEFAULT_TTL_MINUTES,
): Promise<ReservationRecord> {
  const existing = await store.findByKey(input.idempotencyKey);
  if (existing !== undefined) {
    if (
      existing.slug !== input.slug ||
      existing.quantity !== input.quantity ||
      existing.customerId !== input.customerId
    ) {
      throw new ReservationError(
        "conflict",
        "Idempotency key was already used for a different hold.",
      );
    }
    return existing;
  }
  const nowIso = now.toISOString();
  const free = available - (await heldForSlug(store, input.slug, nowIso));
  if (input.quantity > free) {
    throw new ReservationError(
      "insufficient-stock",
      `Only ${Math.max(0, free)} unit(s) available for ${input.slug}.`,
    );
  }
  const ttl = Math.min(Math.max(Math.floor(ttlMinutes), 1), MAX_TTL_MINUTES);
  const record = ReservationRecordSchema.parse({
    id: randomUUID(),
    customerId: input.customerId,
    slug: input.slug,
    quantity: input.quantity,
    idempotencyKey: input.idempotencyKey,
    state: "active",
    expiresAt: new Date(now.getTime() + ttl * 60_000).toISOString(),
    createdAt: nowIso,
  });
  await store.insert(record);
  return record;
}

async function requireLive(
  store: ReservationStore,
  id: string,
  nowIso: string,
): Promise<ReservationRecord> {
  const record = await store.getById(id);
  if (record === undefined) {
    throw new ReservationError("not-found", "Reservation does not exist.");
  }
  if (record.state !== "active" || record.expiresAt <= nowIso) {
    if (record.state === "active") {
      await store.update({ ...record, state: "expired" });
    }
    throw new ReservationError("already-settled", "Reservation is no longer active.");
  }
  return record;
}

export async function heartbeat(store: ReservationStore, id: string, now: Date): Promise<ReservationRecord> {
  const nowIso = now.toISOString();
  const record = await requireLive(store, id, nowIso);
  const cap = Date.parse(record.createdAt) + MAX_TTL_MINUTES * 60_000;
  const extended = Math.min(now.getTime() + DEFAULT_TTL_MINUTES * 60_000, cap);
  const updated: ReservationRecord = {
    ...record,
    expiresAt: new Date(extended).toISOString(),
  };
  await store.update(updated);
  return updated;
}

export async function cancelReservation(
  store: ReservationStore,
  id: string,
  now: Date,
): Promise<ReservationRecord> {
  const record = await requireLive(store, id, now.toISOString());
  const updated: ReservationRecord = { ...record, state: "cancelled" };
  await store.update(updated);
  return updated;
}

/**
 * Consumes a live hold into an order. The hold leaves the
 * availability pool permanently — it can never be re-held,
 * re-committed, or swept afterwards.
 */
export async function commitReservation(
  store: ReservationStore,
  id: string,
  now: Date,
): Promise<ReservationRecord> {
  const record = await requireLive(store, id, now.toISOString());
  const updated: ReservationRecord = { ...record, state: "committed" };
  await store.update(updated);
  return updated;
}

/** Expires overdue holds. Returns the number expired. */
export async function sweep(store: ReservationStore, now: Date): Promise<number> {
  let expired = 0;
  for (const record of await store.listAged(now.toISOString())) {
    await store.update({ ...record, state: "expired" });
    expired += 1;
  }
  return expired;
}
