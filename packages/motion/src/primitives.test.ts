import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { durations, variantClass, variants } from "./index.js";

const dir = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(dir, "primitives.css"), "utf8");

describe("motion primitives", () => {
  it("keeps durations within §36 restraint", () => {
    expect(durations.quick).toBeGreaterThanOrEqual(180);
    expect(durations.quick).toBeLessThanOrEqual(300);
    expect(durations.base).toBeGreaterThanOrEqual(180);
    expect(durations.base).toBeLessThanOrEqual(300);
    expect(durations.panel).toBeGreaterThanOrEqual(250);
    expect(durations.panel).toBeLessThanOrEqual(400);
    expect(durations.slow).toBeLessThanOrEqual(400);
  });

  it("exposes the Phase 1 variant contract", () => {
    expect(variants).toEqual(
      expect.arrayContaining([
        "fade",
        "scale",
        "slide-left",
        "reveal",
        "drawer",
        "overlay",
      ]),
    );
    expect(variantClass("drawer")).toBe("sr-drawer");
  });

  it("animates transform/opacity only (no layout properties)", () => {
    const transitions = Array.from(
      css.matchAll(/transition:[^;]+;/g),
      (m) => m[0],
    );
    expect(transitions.length).toBeGreaterThan(0);
    for (const t of transitions) {
      expect(t).toMatch(/opacity|transform|none/);
      expect(t).not.toMatch(/width|height|top|left|margin|padding/);
    }
    expect(css).not.toMatch(/@keyframes\s+\S+\s*\{[^}]*width|height\s*:/);
  });

  it("answers reduced-motion and no-JS", () => {
    expect(css).toContain("prefers-reduced-motion");
    expect(css).toContain("[data-reveal]");
    expect(css).toContain("noscript");
  });
});
