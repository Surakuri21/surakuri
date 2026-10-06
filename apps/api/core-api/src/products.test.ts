import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ProblemDetailsSchema } from "@surakuri/contracts";
import type { CatalogItem } from "@surakuri/catalog";
import { buildServer } from "./server.js";
import { registerProductRoutes } from "./products.js";
import type { CatalogSource } from "./products.js";

const ITEMS: CatalogItem[] = [
  {
    slug: "daytona-116500ln",
    name: "Cosmograph Daytona",
    price: { amount_minor: 1_250_000, currency: "USD" },
    inStock: true,
    category: "Chronograph",
  },
  {
    slug: "nautilus-5711",
    name: "Nautilus",
    price: { amount_minor: 9_800_000, currency: "USD" },
    inStock: false,
    category: null,
  },
];

function stub(
  overrides: Partial<Record<string, unknown>> = {},
): CatalogSource & { seen: { limit: number; cursor: string | null }[] } {
  const seen: { limit: number; cursor: string | null }[] = [];
  return {
    seen,
    listItems: (args) => {
      seen.push({ limit: args.limit, cursor: args.cursor });
      if (overrides["fail"] === true) {
        return Promise.reject(new Error("db down"));
      }
      return Promise.resolve({ items: ITEMS, nextCursor: null });
    },
  };
}

describe("product routes", () => {
  it("lists schema-shaped items with cursor pagination", async () => {
    const server = buildServer();
    const source = stub();
    registerProductRoutes(server, source);
    const res = await server.inject({
      method: "GET",
      url: "/v1/products?limit=2",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: ITEMS, nextCursor: null });
    expect(source.seen).toEqual([{ limit: 2, cursor: null }]);
    expect(typeof res.headers["x-correlation-id"]).toBe("string");
  });

  it("clamps limits, passes cursors, and rejects bad queries", async () => {
    const server = buildServer();
    const source = stub();
    registerProductRoutes(server, source);
    await server.inject({ method: "GET", url: "/v1/products?limit=999" });
    expect(source.seen[0]?.limit).toBe(50);
    await server.inject({
      method: "GET",
      url: "/v1/products?cursor=daytona-116500ln",
    });
    expect(source.seen[1]?.cursor).toBe("daytona-116500ln");

    const bad = await server.inject({
      method: "GET",
      url: "/v1/products?limit=abc",
    });
    expect(bad.statusCode).toBe(400);
    expect(ProblemDetailsSchema.safeParse(bad.json()).success).toBe(true);
  });

  it("fails closed with schema-valid 503 when the source is down", async () => {
    const server = buildServer();
    registerProductRoutes(server, stub({ fail: true }));
    const res = await server.inject({ method: "GET", url: "/v1/products" });
    expect(res.statusCode).toBe(503);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(ProblemDetailsSchema.safeParse(res.json()).success).toBe(true);
  });
});
