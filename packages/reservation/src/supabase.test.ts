import { describe, expect, it } from "vitest";
import { createSupabaseReservationStore } from "./supabase.js";

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
    "gt",
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
  id: "0195a0b0-0000-7000-8000-000000000010",
  customer_id: "0195a0b0-0000-7000-8000-000000000001",
  slug: "daytona",
  quantity: 2,
  idempotency_key: "h1",
  state: "active",
  expires_at: "2026-10-07T12:15:00Z",
  created_at: "2026-10-07T12:00:00Z",
};

describe("supabase reservation store", () => {
  it("maps rows to records on key lookup", async () => {
    const { client } = fakeDb({ data: ROW, error: null });
    const store = createSupabaseReservationStore(client as never);
    const record = await store.findByKey("h1");
    expect(record).toMatchObject({
      slug: "daytona",
      quantity: 2,
      idempotencyKey: "h1",
      state: "active",
    });
    const missing = createSupabaseReservationStore(
      fakeDb({ data: null, error: null }).client as never,
    );
    expect(await missing.findByKey("nope")).toBeUndefined();
  });

  it("filters live versus aged holds by expiry", async () => {
    const live = fakeDb({ data: [ROW], error: null });
    const store = createSupabaseReservationStore(live.client as never);
    await store.listActive("2026-10-07T12:00:00Z");
    expect(live.calls).toContainEqual({ op: "eq", arg: ["state", "active"] });
    expect(live.calls).toContainEqual({
      op: "gt",
      arg: ["expires_at", "2026-10-07T12:00:00Z"],
    });

    const aged = fakeDb({ data: [], error: null });
    await createSupabaseReservationStore(aged.client as never).listAged(
      "2026-10-07T13:00:00Z",
    );
    expect(aged.calls).toContainEqual({
      op: "lte",
      arg: ["expires_at", "2026-10-07T13:00:00Z"],
    });
  });

  it("writes snake_case rows and surfaces failures", async () => {
    const written = fakeDb({ data: null, error: null });
    const store = createSupabaseReservationStore(written.client as never);
    await store.insert({
      id: ROW.id,
      customerId: ROW.customer_id,
      slug: "daytona",
      quantity: 1,
      idempotencyKey: "h9",
      state: "active",
      expiresAt: ROW.expires_at,
      createdAt: ROW.created_at,
    });
    const inserted = written.calls.find((call) => call.op === "insert");
    expect(inserted?.arg).toMatchObject({
      idempotency_key: "h9",
      customer_id: ROW.customer_id,
    });

    const failing = fakeDb({ data: null, error: { message: "db down" } });
    await expect(
      createSupabaseReservationStore(failing.client as never).insert({
        id: ROW.id,
        customerId: ROW.customer_id,
        slug: "daytona",
        quantity: 1,
        idempotencyKey: "h9",
        state: "active",
        expiresAt: ROW.expires_at,
        createdAt: ROW.created_at,
      }),
    ).rejects.toThrowError(/holds insert failed/);
  });

  it("throws on corrupt rows instead of dropping holds", async () => {
    const corrupt = fakeDb({
      data: { ...ROW, quantity: "two" },
      error: null,
    });
    await expect(
      createSupabaseReservationStore(corrupt.client as never).findByKey("h1"),
    ).rejects.toThrow();
  });
});
