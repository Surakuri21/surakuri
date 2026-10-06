import { describe, expect, it } from "vitest";
import {
  availableQuantity,
  decimalToMinorUnits,
  skuToSlug,
  toMirrorPayload,
} from "./index.js";
import type { ImsProductRow } from "./index.js";

const ROW: ImsProductRow = {
  mysql_id: 7,
  sku: "RLX-DAYTONA 116500LN",
  name: "Daytona",
  unit_price: "12500.00",
  quantity: 3,
  category_name: "Chronograph",
  supplier_name: "Geneva Supply",
  is_active: true,
  synced_at: "2026-10-06T00:00:00Z",
};

describe("ims-adapter", () => {
  it("maps SKUs to slugs without leaking SKU shape", () => {
    expect(skuToSlug("RLX-DAYTONA 116500LN")).toBe("rlx-daytona-116500ln");
    expect(() => skuToSlug("   ")).toThrow();
  });

  it("converts DECIMAL strings to minor units without drift", () => {
    expect(decimalToMinorUnits("12500.00")).toBe(1_250_000);
    expect(decimalToMinorUnits("150000", "JPY")).toBe(150_000);
    // Refuses to silently round: USD allows 2 decimals, not 3.
    expect(() => decimalToMinorUnits("10.001")).toThrow();
  });

  it("builds mirror payloads that cannot contain cost_price", () => {
    const payload = toMirrorPayload(ROW);
    expect(payload.slug).toBe("rlx-daytona-116500ln");
    expect(payload.unit_price).toBe("12500.00");
    expect("cost_price" in payload).toBe(false);
    expect(Object.keys(payload).sort()).toEqual(
      [
        "category_name",
        "is_active",
        "mysql_id",
        "name",
        "quantity",
        "sku",
        "slug",
        "supplier_name",
        "synced_at",
        "unit_price",
      ].sort(),
    );
  });

  it("projects negative stock as zero (fail closed)", () => {
    expect(availableQuantity(3)).toBe(3);
    expect(availableQuantity(0)).toBe(0);
    expect(availableQuantity(-2)).toBe(0);
  });
});
