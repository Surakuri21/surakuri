import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ProblemDetailsSchema } from "@surakuri/contracts";
import { buildServer } from "./server.js";
import { loadConfig } from "./config.js";
import { validate } from "./validation.js";
import { ProblemError } from "./problem.js";

describe("core-api skeleton", () => {
  it("answers GET /health", async () => {
    const server = buildServer();
    const res = await server.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("echoes inbound correlation IDs and generates them when absent", async () => {
    const server = buildServer();
    const echoed = await server.inject({
      method: "GET",
      url: "/health",
      headers: { "x-correlation-id": "client-123" },
    });
    expect(echoed.headers["x-correlation-id"]).toBe("client-123");

    const generated = await server.inject({ method: "GET", url: "/health" });
    expect(typeof generated.headers["x-correlation-id"]).toBe("string");
  });

  it("returns schema-valid problem+json for unknown routes", async () => {
    const server = buildServer();
    const res = await server.inject({ method: "GET", url: "/nope" });
    expect(res.statusCode).toBe(404);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(ProblemDetailsSchema.safeParse(res.json()).success).toBe(true);
  });

  it("validates bodies with contracts schemas (400 ProblemError)", () => {
    const schema = z.object({ quantity: z.number().int().positive() });
    expect(validate(schema, { quantity: 2 })).toEqual({ quantity: 2 });
    try {
      validate(schema, { quantity: 0 });
      expect.unreachable("validate must throw on quantity 0");
    } catch (error) {
      expect(error).toBeInstanceOf(ProblemError);
      expect((error as ProblemError).status).toBe(400);
    }
  });

  it("loads config with safe defaults and rejects a missing SUPABASE_URL", () => {
    expect(
      loadConfig({ SUPABASE_URL: "https://x.supabase.co" }).PORT,
    ).toBe(3001);
    expect(() => loadConfig({})).toThrow();
  });
});
