import { describe, expect, it } from "vitest";
import { buildProductSearch } from "./index.js";

describe("search query builder", () => {
  it("keeps user input in bound parameters, never in the SQL text", () => {
    const hostile = "x'; DROP TABLE public.products; --";
    const query = buildProductSearch(hostile);
    expect(query.values[0]).toBe(hostile);
    expect(query.text).not.toContain("DROP TABLE");
    expect(query.text).toContain("$1");
    expect(query.text).toContain("$4");
  });

  it("normalizes whitespace and clamps limits", () => {
    expect(buildProductSearch("  daytona   116500 ").values[0]).toBe(
      "daytona 116500",
    );
    expect(buildProductSearch("daytona", { limit: 999 }).values[3]).toBe(50);
    expect(buildProductSearch("daytona", { limit: 0 }).values[3]).toBe(1);
    expect(buildProductSearch("daytona").values[3]).toBe(20);
  });

  it("rejects empty, oversized, and out-of-range inputs", () => {
    expect(() => buildProductSearch("   ")).toThrow();
    expect(() => buildProductSearch("a".repeat(201))).toThrow();
    expect(() => buildProductSearch("daytona", { similarity: 2 })).toThrow();
    expect(() => buildProductSearch("daytona", { similarity: -0.1 })).toThrow();
  });
});
