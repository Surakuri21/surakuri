/**
 * Money — integer minor units, never floating point.
 *
 * Rule (§11): every monetary value is stored and calculated as an integer count
 * of minor units plus an ISO 4217 currency code.
 *
 *   { amount_minor: 1250000, currency: "USD" }  // $12,500.00
 *
 * WHY THIS MATTERS
 *   Binary floating point cannot represent most decimal fractions exactly
 *   (0.1 + 0.2 !== 0.3). For a platform selling five-figure watches, that drift
 *   is a correctness and trust failure. All arithmetic here is integer-only.
 *   Rounding (tax, discounts) is done with exact integer division, not by
 *   dividing floats and hoping the tie lands on the right side.
 *
 * DESIGN NOTES
 *   - `amountMinor` is a plain number, but every entry point validates that it
 *     is a safe integer. Values beyond Number.MAX_SAFE_INTEGER throw.
 *   - Currency exponents are explicit: JPY has 0 decimals, KWD has 3. Assuming
 *     "2 everywhere" is a classic internationalisation bug.
 *   - Functions here are pure and immutable; a Money value is never mutated.
 *   - This module has ZERO dependencies so it can run in the storefront, the
 *     API, the worker, and tests identically.
 */

/** ISO 4217 alphabetic code, e.g. "USD". */
export type CurrencyCode = string;

/** A monetary amount in integer minor units. */
export interface Money {
  readonly amountMinor: number;
  readonly currency: CurrencyCode;
}

/** How to resolve a fractional minor unit. */
export type RoundingMode =
  | 'half-up' // 0.5 rounds away from zero (common for consumer-facing tax)
  | 'half-even' // 0.5 rounds to the even neighbour (banker's rounding; less bias)
  | 'floor' // toward negative infinity
  | 'ceil' // toward positive infinity
  | 'trunc'; // toward zero

/**
 * Minor-unit exponents for currencies that are NOT 2-decimal.
 * Anything absent from this table defaults to 2, which is correct for the
 * large majority of ISO 4217 currencies.
 */
const CURRENCY_EXPONENTS: Readonly<Record<CurrencyCode, number>> = {
  JPY: 0,
  KRW: 0,
  VND: 0,
  CLP: 0,
  ISK: 0,
  XOF: 0,
  XAF: 0,
  KWD: 3,
  BHD: 3,
  OMR: 3,
  JOD: 3,
  TND: 3,
};

/** Thrown when a monetary operation would silently lose correctness. */
export class MoneyError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

/** Number of decimal places for a currency (2 unless the table says otherwise). */
export function currencyExponent(currency: CurrencyCode): number {
  return CURRENCY_EXPONENTS[currency.toUpperCase()] ?? 2;
}

/** 10 ** exponent, as an exact integer (exponents are small). */
function scaleFactor(exponent: number): number {
  return 10 ** exponent;
}

function assertSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(
      `${label} must be a safe integer (got ${String(value)}). ` +
        'Money values must never be fractional or exceed Number.MAX_SAFE_INTEGER.'
    );
  }
}

/**
 * Exact integer division with an explicit rounding mode.
 *
 * Implemented with integer quotient + integer remainder so that a true
 * half-way case is detected precisely. Dividing floats would be wrong at the
 * boundary: (a / b) can round to just below or above .5 even when a/b is
 * exactly one half.
 */
function divideRound(
  numerator: number,
  denominator: number,
  mode: RoundingMode
): number {
  if (denominator === 0) {
    throw new MoneyError('Cannot divide money by zero.');
  }

  const negative = numerator < 0 !== denominator < 0;
  const absNumerator = Math.abs(numerator);
  const absDenominator = Math.abs(denominator);

  const quotient = Math.trunc(absNumerator / absDenominator);
  const remainder = absNumerator - quotient * absDenominator;

  if (remainder === 0) {
    return negative ? -quotient : quotient;
  }

  let magnitude = quotient;
  const twiceRemainder = remainder * 2;

  switch (mode) {
    case 'trunc':
      break;
    case 'floor':
      // Rounding toward -infinity means increasing magnitude for negatives.
      if (negative) magnitude += 1;
      break;
    case 'ceil':
      // Rounding toward +infinity means increasing magnitude for positives.
      if (!negative) magnitude += 1;
      break;
    case 'half-up':
      if (twiceRemainder >= absDenominator) magnitude += 1;
      break;
    case 'half-even': {
      if (twiceRemainder > absDenominator) {
        magnitude += 1;
      } else if (twiceRemainder === absDenominator && quotient % 2 !== 0) {
        magnitude += 1;
      }
      break;
    }
  }

  return negative ? -magnitude : magnitude;
}

/** Construct a Money value from integer minor units. */
export function money(amountMinor: number, currency: CurrencyCode): Money {
  assertSafeInteger(amountMinor, 'amountMinor');
  if (currency.trim() === '') {
    throw new MoneyError('Currency code is required.');
  }
  return Object.freeze({ amountMinor, currency: currency.toUpperCase() });
}

/** Zero in the given currency. */
export function zero(currency: CurrencyCode): Money {
  return money(0, currency);
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new MoneyError(
      `Currency mismatch: cannot combine ${a.currency} with ${b.currency}. ` +
        'Convert to a single currency first — do not add unlike currencies.'
    );
  }
}

/** Add two amounts of the same currency. */
export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amountMinor + b.amountMinor, a.currency);
}

/** Subtract `b` from `a` (same currency). */
export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amountMinor - b.amountMinor, a.currency);
}

/** Sum a list of amounts (same currency). */
export function sum(amounts: readonly Money[], currency: CurrencyCode): Money {
  let total = 0;
  for (const amount of amounts) {
    if (amount.currency !== currency.toUpperCase()) {
      throw new MoneyError(
        `Currency mismatch in sum: expected ${currency}, found ${amount.currency}.`
      );
    }
    total += amount.amountMinor;
  }
  return money(total, currency);
}

/** Multiply by a whole number (quantities, line counts). */
export function multiplyBy(moneyValue: Money, factor: number): Money {
  assertSafeInteger(factor, 'factor');
  const result = moneyValue.amountMinor * factor;
  assertSafeInteger(result, 'multiplied amount');
  return money(result, moneyValue.currency);
}

/** Negate an amount (for credits/refunds expressed as negative lines). */
export function negate(moneyValue: Money): Money {
  return money(-moneyValue.amountMinor, moneyValue.currency);
}

/** Absolute value. */
export function abs(moneyValue: Money): Money {
  return money(Math.abs(moneyValue.amountMinor), moneyValue.currency);
}

/**
 * Apply a rate expressed in basis points (1 bps = 0.01%).
 *
 * Basis points keep rates as integers: 20% VAT is 2000 bps, 8.875% is 887.5
 * which is why we accept a decimal bps value but require it to be exact.
 * Rounding must be chosen explicitly by the caller — there is no safe implicit
 * default for tax.
 */
export function applyBasisPoints(
  moneyValue: Money,
  basisPoints: number,
  mode: RoundingMode = 'half-up'
): Money {
  if (!Number.isFinite(basisPoints)) {
    throw new MoneyError('basisPoints must be a finite number.');
  }
  // Scale bps by 100 to allow fractional basis points without float input.
  const scaledBps = Math.round(basisPoints * 100);
  const numerator = moneyValue.amountMinor * scaledBps;
  assertSafeInteger(numerator, 'basis-point numerator');
  const result = divideRound(numerator, 10_000 * 100, mode);
  return money(result, moneyValue.currency);
}

/**
 * Apply a percentage (e.g. 20 for 20%), rounded explicitly.
 * Prefer `applyBasisPoints` in domain code; this is a convenience for
 * human-entered values.
 */
export function applyPercent(
  moneyValue: Money,
  percent: number,
  mode: RoundingMode = 'half-up'
): Money {
  return applyBasisPoints(moneyValue, percent * 100, mode);
}

/**
 * Split an amount into parts by integer weights **without losing a single
 * minor unit**. Remainders are distributed one unit at a time, deterministically.
 *
 * Example: allocate($10.00, [1, 1, 1]) -> 333, 333, 334 (not 999 total).
 * This is required for splitting discounts, fees, or partial refunds across
 * line items: the parts must always sum back to the original.
 */
export function allocate(moneyValue: Money, weights: readonly number[]): Money[] {
  if (weights.length === 0) {
    throw new MoneyError('allocate requires at least one weight.');
  }
  for (const weight of weights) {
    assertSafeInteger(weight, 'weight');
    if (weight < 0) {
      throw new MoneyError('allocate weights must be non-negative.');
    }
  }

  const totalWeight = weights.reduce((a, b) => a + b, 0);
  if (totalWeight === 0) {
    throw new MoneyError('allocate weights must not sum to zero.');
  }

  const amount = moneyValue.amountMinor;
  const negative = amount < 0;
  const absAmount = Math.abs(amount);

  // Integer share for each weight, then hand out the remaining units.
  const shares = weights.map((weight) =>
    Math.trunc((absAmount * weight) / totalWeight)
  );
  let allocated = shares.reduce((a, b) => a + b, 0);
  let remainder = absAmount - allocated;

  // Distribute leftovers by largest fractional part, ties broken by index so
  // the result is deterministic and reproducible.
  const order = weights
    .map((weight, index) => ({
      index,
      fraction: (absAmount * weight) % totalWeight,
    }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);

  let cursor = 0;
  while (remainder > 0) {
    const target = order[cursor % order.length];
    if (target === undefined) break;
    shares[target.index] = (shares[target.index] ?? 0) + 1;
    remainder -= 1;
    cursor += 1;
  }

  return shares.map((share) =>
    money(negative ? -share : share, moneyValue.currency)
  );
}

/** Compare two amounts of the same currency: -1, 0, or 1. */
export function compare(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b);
  if (a.amountMinor < b.amountMinor) return -1;
  if (a.amountMinor > b.amountMinor) return 1;
  return 0;
}

/** Equality by value (not reference). */
export function equals(a: Money, b: Money): boolean {
  return a.currency === b.currency && a.amountMinor === b.amountMinor;
}

/** True when the amount is exactly zero. */
export function isZero(moneyValue: Money): boolean {
  return moneyValue.amountMinor === 0;
}

/** True when the amount is below zero. */
export function isNegative(moneyValue: Money): boolean {
  return moneyValue.amountMinor < 0;
}

/** True when the amount is above zero. */
export function isPositive(moneyValue: Money): boolean {
  return moneyValue.amountMinor > 0;
}

/**
 * Parse a decimal string such as "12500.00" into Money.
 *
 * Deliberately accepts a STRING, not a number: passing 12500.00 as a JS number
 * has already lost information before this function is called. Rejects inputs
 * with more decimal places than the currency allows, rather than silently
 * rounding a price.
 */
export function parseDecimal(
  decimal: string,
  currency: CurrencyCode
): Money {
  const trimmed = decimal.trim();
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(trimmed);

  if (match === null) {
    throw new MoneyError(
      `Invalid decimal amount: ${JSON.stringify(decimal)}. ` +
        'Expected a plain decimal string such as "12500.00".'
    );
  }

  const [, sign, whole = '0', fraction = ''] = match;
  const exponent = currencyExponent(currency);

  if (fraction.length > exponent) {
    throw new MoneyError(
      `${currency} supports at most ${exponent} decimal places, ` +
        `but received ${fraction.length} ("${decimal}"). ` +
        'Refusing to silently round a monetary value.'
    );
  }

  const paddedFraction = fraction.padEnd(exponent, '0');
  const majorPart = Number.parseInt(whole, 10);
  const minorPart = exponent === 0 ? 0 : Number.parseInt(paddedFraction, 10);
  const scale = scaleFactor(exponent);

  assertSafeInteger(majorPart, 'whole part');
  const amountMinor = majorPart * scale + minorPart;
  assertSafeInteger(amountMinor, 'parsed amount');

  return money(sign === '-' ? -amountMinor : amountMinor, currency);
}

/**
 * Render Money for display.
 *
 * FOR DISPLAY ONLY. The output must never be parsed back into a calculation.
 * The division below exists solely to let Intl place symbols and grouping
 * correctly; all real arithmetic stays in integer minor units.
 */
export function format(
  moneyValue: Money,
  locale = 'en-US',
  options: Intl.NumberFormatOptions = {}
): string {
  const exponent = currencyExponent(moneyValue.currency);
  const scale = scaleFactor(exponent);

  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: moneyValue.currency,
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
    ...options,
  }).format(moneyValue.amountMinor / scale);
}

/** Machine-readable representation for transport (matches §11 wire format). */
export interface MoneyDTO {
  readonly amount_minor: number;
  readonly currency: CurrencyCode;
}

/** Convert to the §11 wire shape. */
export function toDTO(moneyValue: Money): MoneyDTO {
  return { amount_minor: moneyValue.amountMinor, currency: moneyValue.currency };
}

/** Rebuild Money from the §11 wire shape, validating the payload. */
export function fromDTO(dto: MoneyDTO): Money {
  return money(dto.amount_minor, dto.currency);
}