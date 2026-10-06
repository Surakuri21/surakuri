import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { breakpointPx, breakpoints, colors, motion } from "./index.js";

describe("design tokens", () => {
  it("locks brand palette (no drift)", () => {
    expect(colors.ink).toBe("#0a0a0b");
    expect(colors.paper).toBe("#faf6f0");
    expect(colors.accent).toBe("#bfa86a");
  });

  it("covers the §94 breakpoint matrix", () => {
    expect(breakpointPx).toMatchObject({
      xs: 320,
      s: 360,
      m: 390,
      l: 430,
      md: 768,
      lg: 1024,
      xl: 1280,
      "2xl": 1440,
    });
    expect(Object.keys(breakpoints)).toEqual(Object.keys(breakpointPx));
  });

  it("keeps motion within §36 restraint (180–400ms)", () => {
    expect(motion.quick).toBeGreaterThanOrEqual(180);
    expect(motion.slow).toBeLessThanOrEqual(400);
    expect(motion.panel).toBeGreaterThanOrEqual(250);
    expect(motion.panel).toBeLessThanOrEqual(400);
  });

  it("keeps tokens.css in sync with tokens.ts", () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const css = readFileSync(join(dir, "tokens.css"), "utf8");
    for (const hex of [colors.ink, colors.paper, colors.accent]) {
      expect(css).toContain(hex);
    }
    expect(css).toContain("@theme");
    expect(css).toContain("prefers-reduced-motion");
  });
});
