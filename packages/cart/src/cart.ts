/**
 * Server-side cart pricing (Master Rule 3).
 *
 * The browser submits `{ slug, quantity }` and nothing else. Unit
 * prices come from the injected lookup — server data, never client
 * input — so a tampered `price` field has nowhere to land. Totals
 * are integer minor units via `packages/money`; multi-currency carts
 * are rejected until `packages/pricing/` owns conversion.
 */

import { money, multiplyBy, sum } from "@surakuri/money";

export type CartFailure =
  | "empty-cart"
  | "bad-quantity"
  | "unknown-product"
  | "currency-mismatch";

export class CartError extends Error {
  public readonly code: CartFailure;

  public constructor(code: CartFailure, message: string) {
    super(message);
    this.name = "CartError";
    this.code = code;
  }
}

export interface CartLine {
  readonly slug: string;
  readonly quantity: number;
}

export interface ServerPrice {
  readonly amountMinor: number;
  readonly currency: string;
}

export interface PricedLine {
  readonly slug: string;
  readonly quantity: number;
  readonly unitMinor: number;
  readonly lineMinor: number;
  readonly currency: string;
}

export interface PricedCart {
  readonly lines: PricedLine[];
  readonly totalMinor: number;
  readonly currency: string;
}

export function priceCart(
  lines: readonly CartLine[],
  priceOf: (slug: string) => ServerPrice | undefined,
): PricedCart {
  if (lines.length === 0) {
    throw new CartError("empty-cart", "Cart has no lines to price.");
  }
  const priced: PricedLine[] = [];
  let currency: string | undefined;
  for (const line of lines) {
    if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0) {
      throw new CartError(
        "bad-quantity",
        `Invalid quantity for ${line.slug}.`,
      );
    }
    const price = priceOf(line.slug);
    if (price === undefined) {
      throw new CartError("unknown-product", `Unknown product ${line.slug}.`);
    }
    currency ??= price.currency;
    if (price.currency !== currency) {
      throw new CartError(
        "currency-mismatch",
        "Multi-currency carts are not supported yet.",
      );
    }
    const lineMinor = multiplyBy(
      money(price.amountMinor, price.currency),
      line.quantity,
    ).amountMinor;
    priced.push({
      slug: line.slug,
      quantity: line.quantity,
      unitMinor: price.amountMinor,
      lineMinor,
      currency: price.currency,
    });
  }
  const totalMinor = sum(
    priced.map((line) => money(line.lineMinor, currency as string)),
    currency as string,
  ).amountMinor;
  return { lines: priced, totalMinor, currency: currency as string };
}
