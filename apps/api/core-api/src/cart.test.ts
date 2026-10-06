import { describe, expect, it } from "vitest";
import { ProblemDetailsSchema } from "@surakuri/contracts";
import { buildServer } from "./server.js";
import { registerCartRoutes } from "./cart.js";

describe("cart routes", () => {
  it("prices carts from server prices only", async () => {
    const server = buildServer();
    registerCartRoutes(server, {
      priceFor: (slug) =>
        Promise.resolve(
          slug === "daytona"
            ? { amountMinor: 1_250_000, currency: "USD" }
            : undefined,
        ),
    });
    const res = await server.inject({
      method: "POST",
      url: "/v1/cart/price",
      payload: { lines: [{ slug: "daytona", quantity: 2 }] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      lines: [
        {
          slug: "daytona",
          quantity: 2,
          unitMinor: 1_250_000,
          lineMinor: 2_500_000,
          currency: "USD",
        },
      ],
      totalMinor: 2_500_000,
      currency: "USD",
    });
  });

  it("maps unknown products to 404 and unwired pricing to 503", async () => {
    const server = buildServer();
    registerCartRoutes(server, {
      priceFor: () => Promise.resolve(undefined),
    });
    const unknown = await server.inject({
      method: "POST",
      url: "/v1/cart/price",
      payload: { lines: [{ slug: "ghost", quantity: 1 }] },
    });
    expect(unknown.statusCode).toBe(404);
    expect(ProblemDetailsSchema.safeParse(unknown.json()).success).toBe(true);

    const dead = buildServer();
    registerCartRoutes(dead, {
      priceFor: () => Promise.reject(new Error("not wired")),
    });
    const res = await dead.inject({
      method: "POST",
      url: "/v1/cart/price",
      payload: { lines: [{ slug: "daytona", quantity: 1 }] },
    });
    expect(res.statusCode).toBe(503);
  });
});
