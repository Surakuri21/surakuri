# ADR 0001 — Fresh monorepo in `Luxury_Watch`

Status: accepted (2026-10-06). Source: DEC-01.

## Context

The previous storefront attempt (`Surakuri-rel-O`) carries `framer-motion`,
`recharts`, `dnd-kit`, `react-router-dom`, `lucide-react`, `date-fns`,
`canvas-confetti`, `uuid`, and a hardcoded 28 KB `products.ts`. That stack
conflicts with the luxury/minimal architecture (§20 islands, §29 <50 KB
gzipped catalog JS, §74 minimal libraries).

## Decision

Build fresh in `Luxury_Watch` as a `pnpm` + `turborepo` monorepo with
`packages/` + `apps/` structure (§9): Astro + Tailwind v4 storefront,
Fastify `core-api` BFF, typed `packages/*` domains. Reuse only design
concepts from `Surakuri-rel-O`, never its code.

## Consequences

- Phase 0–1 must rebuild the full design system (`packages/design-tokens/`
  done, `packages/motion/` done) and the storefront shell (`apps/web/`
  pending).
- Prior Astro work is preserved in `Surakuri-rel-O` but not inherited;
  less debt at the cost of rebuilding the shell.
- Verified: scaffold committed as `5d53419`; private repo
  `Surakuri21/surakuri` holds `main`.
