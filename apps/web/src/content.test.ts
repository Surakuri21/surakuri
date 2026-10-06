import { describe, expect, it } from "vitest";
import { AVAILABILITY, SHOWCASE } from "./content.js";

/**
 * Locks the placeholder contract the shell renders against:
 * brand, model, reference, integer-minor price, availability.
 * Phase 2 replaces the SOURCE (BFF), not this shape.
 */
describe("showcase content contract", () => {
  it("has unique slugs and complete display fields", () => {
    expect(SHOWCASE.length).toBeGreaterThan(0);
    const slugs = SHOWCASE.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const p of SHOWCASE) {
      expect(p.brand.length).toBeGreaterThan(0);
      expect(p.model.length).toBeGreaterThan(0);
      expect(p.reference.length).toBeGreaterThan(0);
    }
  });

  it("prices in integer minor units with ISO currency", () => {
    for (const p of SHOWCASE) {
      expect(Number.isSafeInteger(p.priceMinor)).toBe(true);
      expect(p.priceMinor).toBeGreaterThan(0);
      expect(p.currency).toMatch(/^[A-Z]{3}$/);
    }
  });

  it("only uses known availability states", () => {
    for (const p of SHOWCASE) {
      expect(AVAILABILITY).toContain(p.availability);
    }
  });
});
