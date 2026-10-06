import { describe, expect, it } from "vitest";
import { shapeCatalogItem } from "./index.js";
import type { ImsProductRow } from "@surakuri/ims-adapter";

const ROW: ImsProductRow = {
  mysql_id: 7,
  sku: "RLX-DAYTONA 116500LN",
  name: "Cosmograph Daytona",
  unit_price: "12500.00",
  quantity: 3,
  category_name: "Chronograph",
  supplier_name: "Geneva Supply",
  is_active: true,
  synced_at: "2026-10-06T00:00:00Z",
};

describe("catalog shaping", () => {
  it("shapes a mirror row to a cost-free item", () => {
    expect(shapeCatalogItem(ROW)).toEqual({
      slug: "rlx-daytona-116500ln",
      name: "Cosmograph Daytona",
      price: { amount_minor: 1_250_000, currency: "USD" },
      inStock: true,
      category: "Chronograph",
    });
  });

  it("projects out-of-stock and inactive rows as unavailable, never hidden", () => {
    expect(shapeCatalogItem({ ...ROW, quantity: 0 })).toMatchObject({
      inStock: false,
    });
    expect(shapeCatalogItem({ ...ROW, is_active: false })).toMatchObject({
      inStock: false,
    });
  });

  it("cannot leak cost_price even if the mirror row carries it", () => {
    const tainted = { ...ROW, cost_price: "8000.00" } as ImsProductRow;
    const item = shapeCatalogItem(tainted);
    expect("cost_price" in item).toBe(false);
    expect(Object.keys(item).sort()).toEqual(
      ["category", "inStock", "name", "price", "slug"].sort(),
    );
  });

  it("fails the read on corrupt rows instead of rendering wrong data", () => {
    expect(() =>
      shapeCatalogItem({ ...ROW, unit_price: "10.001" }),
    ).toThrow();
    expect(() => shapeCatalogItem({ ...ROW, name: "" })).toThrow();
    expect(() => shapeCatalogItem({ ...ROW, sku: "   " })).toThrow();
  });
});
