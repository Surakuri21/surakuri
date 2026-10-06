import { describe, expect, it } from "vitest";
import { CartError, priceCart } from "./index.js";

const PRICES: Record<string, { amountMinor: number; currency: string }> = {
  daytona: { amountMinor: 1_250_000, currency: "USD" },
  nautilus: { amountMinor: 9_800_000, currency: "USD" },
};

describe("cart pricing", () => {
  it("prices lines and totals with zero drift", () => {
    const cart = priceCart(
      [
        { slug: "daytona", quantity: 2 },
        { slug: "nautilus", quantity: 1 },
      ],
      (slug) => PRICES[slug],
    );
    expect(cart.lines).toEqual([
      {
        slug: "daytona",
        quantity: 2,
        unitMinor: 1_250_000,
        lineMinor: 2_500_000,
        currency: "USD",
      },
      {
        slug: "nautilus",
        quantity: 1,
        unitMinor: 9_800_000,
        lineMinor: 9_800_000,
        currency: "USD",
      },
    ]);
    expect(cart.totalMinor).toBe(12_300_000);
  });

  it("rejects unknown products, bad quantities, and empty carts", () => {
    expect(() =>
      priceCart([{ slug: "ghost", quantity: 1 }], (slug) => PRICES[slug]),
    ).toThrowError(expect.objectContaining({ code: "unknown-product" }));
    expect(() =>
      priceCart([{ slug: "daytona", quantity: 0 }], (slug) => PRICES[slug]),
    ).toThrowError(expect.objectContaining({ code: "bad-quantity" }));
    expect(() => priceCart([], (slug) => PRICES[slug])).toThrowError(
      expect.objectContaining({ code: "empty-cart" }),
    );
    expect(() =>
      priceCart([{ slug: "daytona", quantity: 1 }], () => ({
        amountMinor: 1,
        currency: "EUR",
      })),
    ).not.toThrow();
  });

  it("rejects multi-currency carts", () => {
    try {
      priceCart(
        [
          { slug: "daytona", quantity: 1 },
          { slug: "nautilus", quantity: 1 },
        ],
        (slug) =>
          slug === "daytona"
            ? { amountMinor: 1, currency: "USD" }
            : { amountMinor: 1, currency: "EUR" },
      );
      expect.unreachable("mixed currencies must throw");
    } catch (error) {
      expect(error).toBeInstanceOf(CartError);
      expect((error as CartError).code).toBe("currency-mismatch");
    }
  });
});
