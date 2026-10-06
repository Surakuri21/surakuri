import { describe, expect, it } from "vitest";
import { createSupabaseCatalogSource } from "./supabase-catalog.js";

/**
 * Fake PostgREST chain: records select/order/limit/gt calls and
 * resolves with canned rows. No network, no credentials.
 */
function fakeClient(
  rows: unknown[],
  error: { readonly message: string } | null = null,
) {
  const calls: { op: string; arg?: unknown }[] = [];
  const chain: Record<string, unknown> = {};
  chain["from"] = (table: string) => {
    calls.push({ op: "from", arg: table });
    return chain;
  };
  chain["select"] = (cols: string) => {
    calls.push({ op: "select", arg: cols });
    return chain;
  };
  chain["order"] = (col: string, opts: unknown) => {
    calls.push({ op: "order", arg: [col, opts] });
    return chain;
  };
  chain["limit"] = (n: number) => {
    calls.push({ op: "limit", arg: n });
    return chain;
  };
  chain["gt"] = (col: string, value: unknown) => {
    calls.push({ op: "gt", arg: [col, value] });
    return chain;
  };
  chain["then"] = (
    resolve: (v: {
      data: unknown[];
      error: { readonly message: string } | null;
    }) => unknown,
  ) => resolve({ data: rows, error });
  return { calls, client: chain };
}

const ROW = {
  mysql_id: 7,
  sku: "B-002",
  name: "Nautilus",
  unit_price: "98000.00",
  quantity: 1,
  category_name: null,
  supplier_name: null,
  is_active: true,
  synced_at: "2026-10-06T00:00:00Z",
};

describe("supabase catalog source", () => {
  it("pages by keyset and shapes rows without cost fields", async () => {
    const first = fakeClient([ROW, { ...ROW, sku: "C-003" }]);
    const source = createSupabaseCatalogSource({
      client: first.client as never,
    });
    const page = await source.listItems({ limit: 1, cursor: null });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ slug: "b-002" });
    expect("cost_price" in (page.items[0] as object)).toBe(false);
    expect(page.nextCursor).toBe("B-002");
    expect(first.calls).toContainEqual({ op: "limit", arg: 2 });

    const second = fakeClient([{ ...ROW, sku: "C-003" }]);
    const next = createSupabaseCatalogSource({
      client: second.client as never,
    });
    const last = await next.listItems({ limit: 1, cursor: "B-002" });
    expect(last.nextCursor).toBeNull();
    expect(second.calls).toContainEqual({ op: "gt", arg: ["sku", "B-002"] });
  });

  it("drops corrupt rows and surfaces read errors", async () => {
    const bad = fakeClient([
      { ...ROW, unit_price: "10.001" },
      { ...ROW, sku: "C-003" },
    ]);
    const source = createSupabaseCatalogSource({
      client: bad.client as never,
    });
    const page = await source.listItems({ limit: 2, cursor: null });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.slug).toBe("c-003");

    const failing = fakeClient([], { message: "boom" });
    const failingSource = createSupabaseCatalogSource({
      client: failing.client as never,
    });
    await expect(
      failingSource.listItems({ limit: 1, cursor: null }),
    ).rejects.toThrowError(/Supabase read failed/);
  });
});
