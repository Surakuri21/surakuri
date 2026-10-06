# SURAKURI — Master Rules (non-negotiable, §92)

These invariants hold across every phase. Any change that violates one
is rejected regardless of schedule pressure.

1. **Never oversell.** The reservation DB guard is the source of truth
   for availability (ADR 0004). Webhook-only deduction is not a guard —
   the IMS webhook is non-idempotent and may double-deduct on retry.
2. **Never expose cost.** `cost_price` never leaves the server boundary:
   excluded from sync payloads, absent from contracts
   (`ProductListItemSchema`), unreachable from the browser (ADR 0003).
3. **Never trust client-side pricing.** Carts and checkouts are
   server-calculated through the BFF; the browser submits quantities,
   never totals.
4. **Reserve before charge.** Payment is captured only against an active
   reservation; if IMS cannot commit at charge time, refund + notify +
   alert (late-commit flow, §14).
5. **Fail closed on inventory, fail open on marketing.** Inventory doubt
   blocks the sale; marketing/personalisation outages never do.
6. **Never silently lose money.** Every order-affecting transition goes
   through the transactional outbox (`order.placed`, etc.); payments
   reconcile against the IMS ledger (§65).
7. **Idempotency everywhere.** Checkouts, webhooks, and reservations
   carry idempotency keys; retries are safe by construction.
8. **Admin is never in the public bundle.** Separate auth, separate
   entry; verify `apps/web` output contains no admin code (§9, §60).
9. **Contracts before code.** Endpoint shapes are defined in
   `packages/contracts/` first; implementations conform to them.
10. **No silent rounding.** All money math is integer minor units with
    explicit rounding (ADR 0002); parsers refuse ambiguous input rather
    than guessing.
