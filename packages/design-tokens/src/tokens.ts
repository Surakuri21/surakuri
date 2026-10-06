/**
 * SURAKURI design tokens — single source of truth.
 *
 * Why this exists: luxury comes from restraint and consistency
 * (typography, spacing, proportion — not decoration). Every UI
 * element reads from here; Tailwind v4 consumes the same values
 * via `tokens.css` (`@theme`), so TS and CSS can never drift.
 *
 * Boundaries:
 * - No component code here. Tokens only.
 * - No webfont downloads here. Font stacks reference system
 *   fonts; `apps/web` owns font loading strategy (perf §29).
 * - Motion values are CSS `transform`/`opacity` only, with
 *   `prefers-reduced-motion` support owned by `packages/motion`.
 */

export const colors = {
  /** Near-black page / header background. */
  ink: "#0a0a0b",
  /** Warm off-white page background. */
  paper: "#faf6f0",
  /** Quiet surface on top of paper (cards, sheets). */
  surface: "#ffffff",
  /** Muted text on paper (secondary). Never below 4.5:1 on paper. */
  muted: "#5b5750",
  /** Hairline borders / dividers. */
  line: "#e6ded2",
  /** Dark surface for footer / inverted sections. */
  coal: "#131316",
  /** Restrained metallic accent. Use sparingly: price, CTA, focus. */
  accent: "#bfa86a",
  /** Darker accent for hover / text-on-paper contrast. */
  accentStrong: "#8f7740",
  /** Text placed on accent fills. */
  onAccent: "#1a1408",
  /** Status only — never decorative. */
  success: "#1e6b3a",
  /** Status only — never decorative. */
  danger: "#9c2b2b",
} as const;

export type ColorName = keyof typeof colors;

export const spacing = {
  xs: "0.25rem",
  sm: "0.5rem",
  md: "0.75rem",
  lg: "1rem",
  xl: "1.5rem",
  "2xl": "2rem",
  "3xl": "3rem",
  "4xl": "4rem",
  "5xl": "6rem",
} as const;

export type SpacingName = keyof typeof spacing;

/** Mobile-first breakpoints. Min-width values. Covers §94 matrix. */
export const breakpoints = {
  xs: "20rem",
  s: "22.5rem",
  m: "24.375rem",
  l: "26.875rem",
  md: "48rem",
  lg: "64rem",
  xl: "80rem",
  "2xl": "90rem",
} as const;

export type BreakpointName = keyof typeof breakpoints;

/** Pixel equivalents of `breakpoints` for JS matchMedia / tests. */
export const breakpointPx = {
  xs: 320,
  s: 360,
  m: 390,
  l: 430,
  md: 768,
  lg: 1024,
  xl: 1280,
  "2xl": 1440,
} as const satisfies Record<BreakpointName, number>;

export const fonts = {
  display: '"Cormorant Garamond", "Didot", "Bodoni MT", Georgia, serif',
  body: '"Inter", -apple-system, "Segoe UI", system-ui, sans-serif',
  mono: '"IBM Plex Mono", ui-monospace, "SF Mono", Menlo, monospace',
} as const;

export type FontName = keyof typeof fonts;

export const typeScale = {
  display: "clamp(2.5rem, 6vw, 4.5rem)",
  h1: "clamp(2rem, 4.5vw, 3rem)",
  h2: "clamp(1.5rem, 3.5vw, 2.25rem)",
  h3: "1.25rem",
  body: "1rem",
  small: "0.875rem",
  caption: "0.75rem",
} as const;

export type TypeScaleName = keyof typeof typeScale;

/**
 * Motion durations (ms). Restrained per §36:
 * small elements 180–300ms, panels/drawers 250–400ms.
 * Properties restricted to transform + opacity (see tokens.css).
 */
export const motion = {
  instant: 0,
  quick: 180,
  base: 240,
  panel: 320,
  slow: 400,
} as const;

export type MotionName = keyof typeof motion;

export const radii = {
  none: "0",
  sm: "0.25rem",
  md: "0.5rem",
  lg: "0.75rem",
  full: "9999px",
} as const;

export type RadiiName = keyof typeof radii;

/** Minimum touch target per §94 (44px). */
export const touchTargetMinPx = 44 as const;

/** Focus ring: visible on every interactive element (§45). */
export const focusRing = {
  width: "2px",
  color: "#8f7740",
  offset: "2px",
} as const;
