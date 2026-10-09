import { describe, expect, it } from "vitest";
import {
  OrderError,
  createMemoryOrderStore,
  createOrder,
  sweepOrders,
  transition,
} from "./index.js";

const CUSTOMER = "0195a0b0-0000-7000-8000-000000000001";
const RESERVATION = "0195a0b0-0000-7000-8000-000000000002";
const T0 = new Date("2026-10-07T12:00:00Z");

function input(key = "order-1") {
  return {
    customerId: CUSTOMER,
    reservationId: RESERVATION,
    items: [{ slug: "daytona", quantity: 2, unitMinor: 1_250_000 }],
    currency: "USD",
    idempotencyKey: key,
  };
}

describe("order state machine", () => {
  it("walks the full lifecycle to delivered", async () => {
    const store = createMemoryOrderStore();
    const created = await createOrder(store, input(), T0);
    expect(created.state).toBe("draft");
    expect(created.totalMinor).toBe(2_500_000);
    let order = await transition(store, created.id, "pending_payment", T0);
    order = await transition(store, order.id, "paid", T0, { paymentRef: "pi_123" });
    expect(order.paymentRef).toBe("pi_123");
    for (const state of ["reserved", "in_fulfilment", "shipped", "delivered"] as const) {
      order = await transition(store, order.id, state, T0);
    }
    expect(order.state).toBe("delivered");
  });

  it("rejects illegal jumps and unpaid capture", async () => {
    const store = createMemoryOrderStore();
    const created = await createOrder(store, input(), T0);
    await expect(transition(store, created.id, "paid", T0)).rejects.toThrowError(
      expect.objectContaining({ code: "invalid-transition" }),
    );
    await expect(
      transition(store, created.id, "pending_payment", T0),
    ).resolves.toBeDefined();
    await expect(
      transition(store, created.id, "paid", T0),
    ).rejects.toThrowError(
      expect.objectContaining({ code: "missing-payment-ref" }),
    );
  });

  it("replays idempotency keys and rejects reuse", async () => {
    const store = createMemoryOrderStore();
    const first = await createOrder(store, input("k1"), T0);
    expect((await createOrder(store, input("k1"), T0)).id).toBe(first.id);
    await expect(
      createOrder(store, { ...input("k1"), currency: "EUR" }, T0),
    ).rejects.toThrowError(expect.objectContaining({ code: "conflict" }));
  });

  it("expires stale pending orders via the sweeper", async () => {
    const store = createMemoryOrderStore();
    const created = await createOrder(store, input(), T0);
    await transition(store, created.id, "pending_payment", T0);
    const later = new Date(T0.getTime() + 61 * 60_000);
    expect(await sweepOrders(store, later)).toBe(1);
    await expect(
      transition(store, created.id, "paid", later, { paymentRef: "pi_1" }),
    ).rejects.toThrowError(
      expect.objectContaining({ code: "invalid-transition" }),
    );
  });

  it("throws not-found for unknown orders", async () => {
    const store = createMemoryOrderStore();
    await expect(
      transition(store, "0195a0b0-0000-7000-8000-000000000099", "cancelled", T0),
    ).rejects.toThrowError(expect.objectContaining({ code: "not-found" }));
    await expect(
      createOrder(store, { ...input(), items: [] }, T0),
    ).rejects.toThrow();
  });
});
