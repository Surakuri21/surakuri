/**
 * SURAKURI motion primitives — logic half of the pair.
 *
 * CSS half lives in `primitives.css` (transform/opacity only).
 * This file owns: typed durations/easings (synced with
 * `@surakuri/design-tokens`), reduced-motion detection, and a
 * tiny IntersectionObserver helper for scroll reveal.
 *
 * Rules (§36, §39):
 * - Small elements: 180–300ms. Panels/drawers: 250–400ms.
 * - Properties: transform + opacity ONLY. Never animate
 *   width/height/top/left (layout thrash, CLS risk).
 * - No infinite animations. No JS animation library.
 * - `prefers-reduced-motion: reduce` disables everything.
 */

import { motion as tokenMotion } from "@surakuri/design-tokens";

/** Durations in ms, mirrored from design tokens (single source). */
export const durations = {
  quick: tokenMotion.quick,
  base: tokenMotion.base,
  panel: tokenMotion.panel,
  slow: tokenMotion.slow,
} as const;

export type DurationName = keyof typeof durations;

/** Luxury easing: quiet ease-out, no bounce, no overshoot. */
export const easings = {
  standard: "cubic-bezier(0.22, 1, 0.36, 1)",
  entrance: "cubic-bezier(0.16, 1, 0.3, 1)",
} as const;

export type EasingName = keyof typeof easings;

/** Primitive variants exposed as CSS classes in primitives.css. */
export const variants = [
  "fade",
  "fade-up",
  "scale",
  "slide-left",
  "slide-right",
  "reveal",
  "drawer",
  "overlay",
] as const;

export type MotionVariant = (typeof variants)[number];

/** CSS class for a variant: `sr-fade`, `sr-drawer`, … */
export function variantClass(variant: MotionVariant): string {
  return `sr-${variant}`;
}

/** True when the OS/browser requests reduced motion. SSR-safe. */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export interface RevealOptions {
  /** Class added when the element enters the viewport. Default `is-visible`. */
  readonly visibleClass?: string;
  /** Fraction of the element that must be visible. Default 0.15. */
  readonly threshold?: number;
  /** Stop observing after first reveal. Default true (no re-trigger). */
  readonly once?: boolean;
}

/**
 * Observe `[data-reveal]` descendants of `root` and add the visible
 * class on intersection. Returns a cleanup function.
 *
 * Usage (Astro / React island):
 *   import "@surakuri/motion/primitives.css";
 *   useEffect(() => observeReveals(ref.current), []);
 *
 * Elements opt out with `data-reveal="off"`.
 * Reduced-motion users see content immediately (CSS handles it;
 * this helper skips observation and reveals at once).
 */
export function observeReveals(
  root: ParentNode | null,
  options: RevealOptions = {},
): () => void {
  const { visibleClass = "is-visible", threshold = 0.15, once = true } = options;
  if (root === null || typeof IntersectionObserver === "undefined") {
    return () => undefined;
  }
  const scope: ParentNode = root;
  const targets = Array.from(
    scope.querySelectorAll<HTMLElement>("[data-reveal]:not([data-reveal='off'])"),
  );
  if (targets.length === 0) {
    return () => undefined;
  }
  if (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    for (const el of targets) el.classList.add(visibleClass);
    return () => undefined;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add(visibleClass);
        if (once) io.unobserve(entry.target);
      }
    },
    { threshold },
  );
  for (const el of targets) io.observe(el);
  return () => io.disconnect();
}
