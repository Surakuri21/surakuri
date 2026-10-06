# ADR 0002 — Money as integer minor units

Status: accepted (2026-10-06). Source: DEC-05 (§11, §66 Test 7).

## Context

Binary floating point cannot represent most decimal fractions exactly
(`0.1 + 0.2 !== 0.3`). For five-figure watches that drift is a correctness
and trust failure, and `database.sql` stores `DECIMAL(10,2)` — a second,
incompatible representation owned by the IMS.

## Decision

`Money` is `{ amountMinor: safe integer; currency: CurrencyCode }`
(`packages/money/`). All arithmetic is integer-only with explicit rounding
modes (`half-up`, `half-even`, `floor`, `ceil`, `trunc`); percentages use
basis points; `allocate()` splits deterministically with zero lost units.
The IMS adapter (not the storefront) converts `DECIMAL` → `amountMinor`
at the boundary (§8 ownership). No float arithmetic anywhere.

## Consequences

- `packages/pricing/` and `packages/checkout/` must use `packages/money/`.
- Verified: 56/56 Vitest pass, including Test 7 (tax across 2000 prices
  matches `Math.floor((minor * 20 + 50) / 100)`); strict typecheck clean.
