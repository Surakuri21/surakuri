# Runbook RB-0001 — Lock down `public.products` in Supabase

**Severity:** High — live, verified exposure
**Status:** Prepared, not yet applied (no DDL credential available in this environment)
**Migration:** `supabase/migrations/0001_lock_down_products.sql`
**Date prepared:** 2026-10-05

---

## 1. What is wrong

The `public.products` table in the SURAKURI Supabase project was reachable
with the **browser-shipped anon key**. Verified with non-destructive probes
(zero-row no-ops — no data was modified):

> **Project reference withheld.** The concrete project ref is recorded
> out-of-band (not in this repository). This document is public, and pairing a
> project ref with "currently world-writable, fix not yet applied" would be a
> disclosure in itself. Substitute the real ref when executing.

| Probe | Result | Meaning |
|---|---|---|
| `GET /rest/v1/products?select=*&limit=3` | `HTTP 200` | Catalog readable by anyone |
| `PATCH /rest/v1/products?sku=eq.<nonexistent>` | `HTTP 200` | **anon can UPDATE** |
| `DELETE /rest/v1/products?sku=eq.<nonexistent>` | `HTTP 204` | **anon can DELETE** |

Because `SELECT` was unrestricted, the returned columns also exposed:

- `cost_price` — **inventory cost / margin**, an explicit "never expose" item
- `supplier_name`, `mysql_id`, `low_stock_threshold`

**Blast radius (measured, not assumed):** only `products` is exposed. Probed
`orders`, `customers`, `profiles`, `payments`, `reservations`, `units`, `cart`,
`waitlist`, `collections`, `journal`, `newsletter` — **none exist**. Current
contents are test rows only. Impact is therefore latent-but-serious: the moment
`orders` or `payments` is added, it would be world-readable under the same
default-privilege behaviour.

**Not compromised:** `.env` is gitignored and was never committed
(`git log --all -- .env` is empty); no service-role key appears in git history.

---

## 2. Why RLS alone is not the fix

Two independent gates decide access in Postgres: **table privileges** and
**RLS policies**. Revoking only one leaves the other open, and Supabase grants
the `anon`/`authenticated` roles wide table privileges by default. The migration
closes both, and also clears default privileges so future tables start closed.

A second, subtler issue: the IMS sync (`includes/supabase.php`) *supplies*
`cost_price` on every upsert, so simply hiding the column from reads would not
stop margin data leaving the IMS. It is removed from the sync payload too.

**Schema note (verified empirically):** PostgREST's generated OpenAPI document
lists `cost_price` as `required`, but that metadata is **not authoritative**.
A probe `INSERT` omitting the column returned **HTTP 201**, proving the column is
already nullable in the live database; the probe row was deleted afterwards, and
the pre-existing row's `cost_price` was confirmed unchanged at `1000.00`.
Always confirm nullability with a live reversible probe rather than trusting the
generated spec.

---

## 3. Procedure

### Step 1 — Apply migration 0001

No Supabase CLI, `psql`, or DB connection string exists in this environment, so
run the SQL manually:

1. Open the Supabase dashboard → **SQL Editor**.
2. Paste the full contents of `supabase/migrations/0001_lock_down_products.sql`.
3. Run it. It is wrapped in a transaction and is idempotent.

This step **closes the write/read exposure**. The `drop not null` it contains is
defensive only (the column is already nullable).

### Step 2 — Deploy the IMS code change

Apply the change that removes `cost_price` from the sync payload
(`includes/supabase.php`, plus the `$syncProduct` arrays in
`actions/products/create.php` and `actions/products/update.php`).
**Already applied in this working tree** and syntax-verified.

### Step 3 — Verify

**In SQL:**

```sql
-- Expect zero rows.
select policyname, roles, cmd, qual
from pg_policies
where schemaname = 'public' and tablename = 'products';

-- Expect no rows for anon/authenticated.
select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = 'products'
  and grantee in ('anon', 'authenticated');
```

**From the shell** — re-run the probes and confirm they now fail:

```powershell
$envFile = "C:\Users\Adria\Cursor Workspace\Surakuri-rel-O\.env"
$url = ((Get-Content $envFile | Where-Object { $_ -match '^PUBLIC_SUPABASE_URL=' }) -replace '^PUBLIC_SUPABASE_URL=','').Trim()
$key = ((Get-Content $envFile | Where-Object { $_ -match '^PUBLIC_SUPABASE_ANON_KEY=' }) -replace '^PUBLIC_SUPABASE_ANON_KEY=','').Trim()
$h = @{ apikey=$key; Authorization="Bearer $key" }

# Each of these MUST now return 401 or 403.
try { (Invoke-WebRequest "$url/rest/v1/products?select=*&limit=1" -Headers $h -UseBasicParsing).StatusCode } catch { "GET blocked: $([int]$_.Exception.Response.StatusCode)" }
try { (Invoke-WebRequest "$url/rest/v1/products?sku=eq.__probe__" -Method PATCH -Headers $h -Body '{}' -UseBasicParsing).StatusCode } catch { "PATCH blocked: $([int]$_.Exception.Response.StatusCode)" }
try { (Invoke-WebRequest "$url/rest/v1/products?sku=eq.__probe__" -Method DELETE -Headers $h -UseBasicParsing).StatusCode } catch { "DELETE blocked: $([int]$_.Exception.Response.StatusCode)" }
```

**Regression check (must still pass):** the IMS→Supabase sync uses the
**service_role** key, which the migration deliberately does not touch. Confirm an
admin create/update in the IMS still upserts:

```
docker exec inventory_management-php-fpm-1 php /var/www/html/test_integration.php
```

### Step 4 — Follow-up (migration 0002, not yet written)

Once Step 2 is deployed and verified, drop the column outright:

```sql
alter table public.products drop column cost_price;
```

The mirror then carries no margin data at all — defence in depth, so a future
misconfiguration cannot leak it again.

### Step 5 — Rotate the webhook secret (separate finding, see §5)

---

## 4. Rollback

Only if the storefront genuinely needs direct browser reads. Any rollback must
NOT re-expose `cost_price` — drop that column first.

```sql
begin;
  create policy products_public_read on public.products
      for select to anon, authenticated using (is_active = true);
  grant select on table public.products to anon, authenticated;
commit;
```

---

## 5. Related findings NOT fixed by this runbook

Recorded here so they are not lost; each needs its own decision.

1. **Webhook secret moved out of source — rotation still outstanding.**
   `api/sync-order.php` previously hardcoded the shared secret. It now reads
   `INVENTORY_SYNC_SECRET` via the new `includes/env.php` loader, with the
   legacy value as a temporary fallback so the current stack keeps working
   (verified live: valid key → not 401, wrong key → 401). The literal still
   appears in `INTEGRATION_TEST_GUIDE.md` examples and as the fallback in
   `test_integration.php`.
   **Still required:** generate a new secret (`openssl rand -hex 32`), set
   `INVENTORY_SYNC_SECRET` in `.env`, update the storefront's matching config,
   **remove the code fallback**, and change the secret in
   `INTEGRATION_TEST_GUIDE.md`. Until the fallback is removed and the value
   rotated, the old secret remains valid. Note the IMS has no version control
   (see finding 5), so the committed literal cannot be purged from history.
2. **`sync-order.php` is not idempotent.** It ignores
   `transactions.idempotency_key`, so a retried webhook delivery
   **double-deducts stock** — a direct oversell path (§92 invariant 1).
3. **Stock moves with no ledger row.** It updates `products.quantity` and writes
   `audit_logs`, but never inserts into `transactions`. Storefront sales
   therefore cannot be reconciled against the IMS transaction ledger (§65).
4. **`product_slug` is matched against `products.sku`** — a naming mismatch the
   `ims-adapter` must absorb rather than leak into SURAKURI.
5. **The IMS is not under version control.** `git rev-parse` fails in
   `Inventory_Management`. There are no commits, no history, and no way to
   review or revert changes to the system of record. This is a standing risk
   for a component that owns physical inventory.

---

## 6. Invariants this runbook protects

- No inventory cost data is exposed to the browser (§60).
- The browser holds no key that can mutate inventory (§92.6).
- The IMS → Supabase mirror remains writable by the server-side sync only
  (Rule 2 — one owner per dataset).