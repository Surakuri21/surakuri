import { describe, expect, it } from "vitest";
import { createSupabaseOrderStore } from "./supabase.js";

interface Call {
  op: string;
  arg?: unknown;
}

function fakeDb(result: { data: unknown; error: { message: string } | null }) {
  const calls: Call[] = [];
  const chain: Record<string, unknown> = {};
  for (const op of [
    "from",
    "select",
    "eq",
    "lte",
    "insert",
    "update",
    "maybeSingle",
  ]) {
    chain[op] = (...args: unknown[]) => {
      calls.push({ op, arg: args.length === 1 ? args[0] : args });
      return chain;
    };
  }
  chain["then"] = (resolve: (value: unknown) => unknown) =>
    resolve(result);
  return { calls, client: chain };
}

const ROW = {
  id: "0195a0b0-0000-7000-8000-000000000020",
  customer_id: "0195a0b0-0000-7000-8000-000000000001",
  reservation_id: "0195a0b0-0000-7000-8000-000000000002",
  items: [{ slug: "daytona", quantity: 1, unitMinor: 1_250_000 }],
  total_minor: 1_250_000,
  currency: "USD",
  idempotency_key: "o1",
  state: "pending_payment",
  payment_ref: null,
  created_at: "2026-10-07T12:00:00Z",
  updated_at: "2026-10-07T12:00:00Z",
};

describe("supabase order store", () => {
  it("maps rows to records, omitting null payment refs", async () => {
    const { client } = fakeDb({ data: ROW, error: null });
    const record = await createSupabaseOrderStore(client as never).getById(
      ROW.id,
    );
    expect(record).toMatchObject({
      totalMinor: 1_250_000,
      state: "pending_payment",
    });
    expect(record).not.toHaveProperty("paymentRef");

    const paid = fakeDb({
      data: { ...ROW, state: "paid", payment_ref: "pi_1" },
      error: null,
    });
    const paidRecord = await createSupabaseOrderStore(
      paid.client as never,
    ).getById(ROW.id);
    expect(paidRecord?.paymentRef).toBe("pi_1");
  });

  it("lists stale pending orders by creation cutoff", async () => {
    const db = fakeDb({ data: [], error: null });
    await createSupabaseOrderStore(db.client as never).listStalePending(
      "2026-10-07T11:00:00Z",
    );
    expect(db.calls).toContainEqual({
      op: "eq",
      arg: ["state", "pending_payment"],
    });
    expect(db.calls).toContainEqual({
      op: "lte",
      arg: ["created_at", "2026-10-07T11:00:00Z"],
    });
  });

  it("writes snake_case rows and surfaces failures", async () => {
    const db = fakeDb({ data: null, error: null });
    await createSupabaseOrderStore(db.client as never).insert({
      id: ROW.id,
      customerId: ROW.customer_id,
      reservationId: ROW.reservation_id,
      items: [{ slug: "daytona", quantity: 1, unitMinor: 1_250_000 }],
      totalMinor: 1_250_000,
      currency: "USD",
      idempotencyKey: "o9",
      state: "draft",
      createdAt: ROW.created_at,
      updatedAt: ROW.updated_at,
    });
    expect(
      db.calls.find((call) => call.op === "insert")?.arg,
    ).toMatchObject({ idempotency_key: "o9", total_minor: 1_250_000 });

    const failing = fakeDb({ data: null, error: { message: "db down" } });
    await expect(
      createSupabaseOrderStore(failing.client as never).getById(ROW.id),
    ).rejects.toThrowError(/orders read failed/);
  });
});
