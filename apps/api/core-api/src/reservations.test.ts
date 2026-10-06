import { describe, expect, it } from "vitest";
import { ProblemDetailsSchema } from "@surakuri/contracts";
import { createMemoryStore } from "@surakuri/reservation";
import { buildServer } from "./server.js";
import { registerReservationRoutes } from "./reservations.js";

const CUSTOMER = "0195a0b0-0000-7000-8000-000000000001";
const T0 = new Date("2026-10-06T12:00:00Z");

function createBody(key: string, quantity = 1) {
  return {
    customerId: CUSTOMER,
    items: [{ slug: "daytona", quantity, idempotencyKey: key }],
  };
}

describe("reservation routes", () => {
  it("creates holds and reports oversell as 409", async () => {
    const server = buildServer();
    registerReservationRoutes(server, {
      store: createMemoryStore(),
      availabilityForSlug: () => Promise.resolve(1),
      clock: () => T0,
    });
    const created = await server.inject({
      method: "POST",
      url: "/v1/reservations",
      payload: createBody("k1"),
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()["reservations"]).toHaveLength(1);

    const oversell = await server.inject({
      method: "POST",
      url: "/v1/reservations",
      payload: createBody("k2"),
    });
    expect(oversell.statusCode).toBe(409);
    expect(ProblemDetailsSchema.safeParse(oversell.json()).success).toBe(true);
  });

  it("runs heartbeat, cancel, and sweep flows", async () => {
    const server = buildServer();
    registerReservationRoutes(server, {
      store: createMemoryStore(),
      availabilityForSlug: () => Promise.resolve(5),
      clock: () => T0,
    });
    const created = await server.inject({
      method: "POST",
      url: "/v1/reservations",
      payload: createBody("k1"),
    });
    const id = created.json()["reservations"][0]["id"] as string;

    const beat = await server.inject({
      method: "POST",
      url: "/v1/reservations/heartbeat",
      payload: { id },
    });
    expect(beat.statusCode).toBe(200);

    const cancelled = await server.inject({
      method: "POST",
      url: "/v1/reservations/cancel",
      payload: { id },
    });
    expect(cancelled.json()["state"]).toBe("cancelled");

    const swept = await server.inject({
      method: "POST",
      url: "/v1/reservations/sweep",
    });
    expect(swept.json()).toEqual({ expired: 0 });
  });

  it("fails closed with 503 when availability is unwired", async () => {
    const server = buildServer();
    registerReservationRoutes(server, {
      store: createMemoryStore(),
      availabilityForSlug: () =>
        Promise.reject(new Error("not wired")),
      clock: () => T0,
    });
    const res = await server.inject({
      method: "POST",
      url: "/v1/reservations",
      payload: createBody("k1"),
    });
    expect(res.statusCode).toBe(503);
    expect(ProblemDetailsSchema.safeParse(res.json()).success).toBe(true);
  });
});
