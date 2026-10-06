# ADR 0005 — Reduced-motion-first animation primitives

Status: accepted (2026-10-06). Source: DEC-04 (§36, §37, §39, §46).

## Context

`Surakuri-rel-O` animates via `framer-motion` throughout (`CartDrawer`,
`Header`, `HomePage`, `ProductCard`, `Shared`) — a JS animation runtime
that breaks the §29 catalog JS budget and has no systematic
reduced-motion answer. Luxury motion must communicate purpose, not
decorate (§12 philosophy: restraint).

## Decision

Motion is CSS `transform`/`opacity` only, implemented in
`packages/motion/` (`sr-fade`, `sr-fade-up`, `sr-scale`,
`sr-slide-left/right`, `sr-reveal`, `sr-drawer` + `sr-overlay`) with
durations from design tokens (small 180–300ms, panels 250–400ms per
§36), quiet ease-out curves, no infinite animations, and no JS animation
library. Every variant has a reduced-motion answer
(`prefers-reduced-motion` CSS block + `observeReveals()` instant-reveal)
and a no-JS answer (`noscript` fallback never traps content invisible).
Vite operates only as Astro's build/dev engine; no separate Vite app, no
extra plugins.

## Consequences

- Verified: 4/4 Vitest pass (duration restraint, variant contract,
  layout-property guard rejects width/height/top/left, reduced-motion
  and no-JS presence); strict typecheck clean.
- Drawer/overlay pairs replace `AnimatePresence` usage in the rebuild.
