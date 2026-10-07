import { describe, expect, it } from "vitest";
import { ProblemDetailsSchema } from "@surakuri/contracts";
import { createMemoryStore, reserve } from "@surakuri/reservation";
import { createMemoryOrderStore } from "@surakuri/order";
import type { OutboxEnvelope } from "@surakuri/worker";
import { buildServer } from "./server.js";
import { registerOrderRoutes } from "./orders.js";

const CUSTOMER = "0195a0b0-0000-7000-8000-000000000001";
const T0 = new Date("2026-10-07T12:00:00Z");

function setup(priceMinor = 1_250_000) {
  const holds = createMemoryStore();
  const hold = reserve(
    holds,
    { customerId: CUSTOMER, slug: "daytona", quantity: 1, idempotencyKey: "h1" },
    5,
    T0,
  );
  const events: OutboxEnvelope[] = [];
  return {
    holds,
    hold,
    events,
    priceFor: () => Promise.resolve({ amountMinor: priceMinor, currency: "USD" }),
  };
}

describe("order routes", () => {
  it("creates orders from live holds and publishes order.placed", async () => {
    const server = buildServer();
    const { holds, hold, events, priceFor } = setup();
    registerOrderRoutes(server, {
      orders: createMemoryOrderStore(),
      holds,
      priceFor,
      publish: (event) => {
        events.push(event);
      },
      clock: () => T0,
    });
    const res = await server.inject({
      method: "POST",
      url: "/v1/orders",
      payload: {
        customerId: CUSTOMER,
        reservationId: hold.id,
        idempotencyKey: "o1",
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { order: { state: string }; eventId: string };
    expect(body.order.state).toBe("pending_payment");
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("order.placed");

    // The hold is consumed: ordering again on it fails.
    const replay = await server.inject({
      method: "POST",
      url: "/v1/orders",
      payload: {
        customerId: CUSTOMER,
        reservationId: hold.id,
        idempotencyKey: "o2",
      },
    });
    expect(replay.statusCode).toBe(409);
  });

  it("reads and cancels orders", async () => {
    const server = buildServer();
    const { holds, hold, events, priceFor } = setup();
    registerOrderRoutes(server, {
      orders: createMemoryOrderStore(),
      holds,
      priceFor,
      publish: (event) => {
        events.push(event);
      },
      clock: () => T0,
    });
    const created = await server.inject({
      method: "POST",
      url: "/v1/orders",
      payload: {
        customerId: CUSTOMER,
        reservationId: hold.id,
        idempotencyKey: "o1",
      },
    });
    const id = (created.json() as { order: { id: string } }).order.id;
    const fetched = await server.inject({ method: "GET", url: `/v1/orders/${id}` });
    expect(fetched.statusCode).toBe(200);
    const cancelled = await server.inject({
      method: "POST",
      url: `/v1/orders/${id}/cancel`,
    });
    expect(cancelled.json()["state"]).toBe("cancelled");

    const missing = await server.inject({
      method: "GET",
      url: "/v1/orders/0195a0b0-0000-7000-8000-000000000099",
    });
    expect(missing.statusCode).toBe(404);
    expect(ProblemDetailsSchema.safeParse(missing.json()).success).toBe(true);
  });
});
