import { describe, expect, it } from 'vitest';

import {
  abs,
  add,
  allocate,
  applyBasisPoints,
  applyPercent,
  compare,
  currencyExponent,
  equals,
  format,
  fromDTO,
  isNegative,
  isPositive,
  isZero,
  MoneyError,
  money,
  multiplyBy,
  negate,
  parseDecimal,
  subtract,
  sum,
  toDTO,
  zero,
} from './index.js';

describe('construction and validation', () => {
  it('creates money from integer minor units', () => {
    const price = money(1_250_000, 'USD');
    expect(price.amountMinor).toBe(1_250_000);
    expect(price.currency).toBe('USD');
  });

  it('normalises the currency code to upper case', () => {
    expect(money(100, 'usd').currency).toBe('USD');
  });

  it('rejects fractional minor units', () => {
    expect(() => money(12.5, 'USD')).toThrow(MoneyError);
  });

  it('rejects unsafe integers (beyond MAX_SAFE_INTEGER)', () => {
    expect(() => money(Number.MAX_SAFE_INTEGER + 1, 'USD')).toThrow(MoneyError);
  });

  it('rejects non-finite values', () => {
    expect(() => money(Number.NaN, 'USD')).toThrow(MoneyError);
    expect(() => money(Number.POSITIVE_INFINITY, 'USD')).toThrow(MoneyError);
  });

  it('rejects an empty currency code', () => {
    expect(() => money(100, '   ')).toThrow(MoneyError);
  });

  it('is immutable once created', () => {
    const price = money(100, 'USD');
    expect(Object.isFrozen(price)).toBe(true);
  });
});

describe('arithmetic on the same currency', () => {
  it('adds exactly', () => {
    expect(add(money(1_000, 'USD'), money(2_500, 'USD')).amountMinor).toBe(3_500);
  });

  it('subtracts exactly', () => {
    expect(subtract(money(1_000, 'USD'), money(250, 'USD')).amountMinor).toBe(750);
  });

  it('multiplies by an integer factor', () => {
    expect(multiplyBy(money(3_500, 'EUR'), 3).amountMinor).toBe(10_500);
  });

  it('rejects a fractional multiplier', () => {
    expect(() => multiplyBy(money(100, 'USD'), 1.5)).toThrow(MoneyError);
  });

  it('sums a list', () => {
    const total = sum([money(100, 'USD'), money(200, 'USD'), money(300, 'USD')], 'USD');
    expect(total.amountMinor).toBe(600);
  });

  it('refuses to combine different currencies', () => {
    expect(() => add(money(100, 'USD'), money(100, 'EUR'))).toThrow(MoneyError);
    expect(() => subtract(money(100, 'USD'), money(100, 'EUR'))).toThrow(MoneyError);
    expect(() => compare(money(100, 'USD'), money(100, 'EUR'))).toThrow(MoneyError);
  });

  it('refuses to sum a list containing a foreign currency', () => {
    expect(() => sum([money(100, 'USD'), money(100, 'EUR')], 'USD')).toThrow(MoneyError);
  });

  it('negates and takes absolute value', () => {
    expect(negate(money(500, 'USD')).amountMinor).toBe(-500);
    expect(abs(money(-500, 'USD')).amountMinor).toBe(500);
  });

  it('tests sign and zero', () => {
    expect(isZero(zero('USD'))).toBe(true);
    expect(isPositive(money(1, 'USD'))).toBe(true);
    expect(isNegative(money(-1, 'USD'))).toBe(true);
    expect(isPositive(money(-1, 'USD'))).toBe(false);
  });

  it('compares by value', () => {
    expect(compare(money(100, 'USD'), money(200, 'USD'))).toBe(-1);
    expect(compare(money(200, 'USD'), money(200, 'USD'))).toBe(0);
    expect(compare(money(300, 'USD'), money(200, 'USD'))).toBe(1);
  });

  it('compares by value for equality, not reference', () => {
    expect(equals(money(100, 'USD'), money(100, 'USD'))).toBe(true);
    expect(equals(money(100, 'USD'), money(100, 'EUR'))).toBe(false);
  });
});

describe('currency exponents', () => {
  it('defaults to 2 decimals', () => {
    expect(currencyExponent('USD')).toBe(2);
    expect(currencyExponent('EUR')).toBe(2);
  });

  it('knows zero-decimal currencies', () => {
    expect(currencyExponent('JPY')).toBe(0);
    expect(currencyExponent('KRW')).toBe(0);
  });

  it('knows three-decimal currencies', () => {
    expect(currencyExponent('KWD')).toBe(3);
    expect(currencyExponent('BHD')).toBe(3);
  });
});

describe('parsing decimal strings', () => {
  it('parses a whole amount', () => {
    expect(parseDecimal('12500', 'USD').amountMinor).toBe(1_250_000);
  });

  it('parses a two-decimal amount', () => {
    expect(parseDecimal('12500.00', 'USD').amountMinor).toBe(1_250_000);
    expect(parseDecimal('0.01', 'USD').amountMinor).toBe(1);
    expect(parseDecimal('19.99', 'USD').amountMinor).toBe(1_999);
  });

  it('parses a single decimal place', () => {
    expect(parseDecimal('1.5', 'USD').amountMinor).toBe(150);
  });

  it('parses negatives', () => {
    expect(parseDecimal('-19.99', 'USD').amountMinor).toBe(-1_999);
  });

  it('handles zero-decimal currencies', () => {
    expect(parseDecimal('1000', 'JPY').amountMinor).toBe(1_000);
  });

  it('handles three-decimal currencies', () => {
    expect(parseDecimal('1.234', 'KWD').amountMinor).toBe(1_234);
  });

  it('rejects too many decimal places instead of silently rounding', () => {
    expect(() => parseDecimal('1.005', 'USD')).toThrow(MoneyError);
    expect(() => parseDecimal('10.5', 'JPY')).toThrow(MoneyError);
  });

  it('rejects malformed input', () => {
    expect(() => parseDecimal('abc', 'USD')).toThrow(MoneyError);
    expect(() => parseDecimal('1,000.00', 'USD')).toThrow(MoneyError);
    expect(() => parseDecimal('$10', 'USD')).toThrow(MoneyError);
    expect(() => parseDecimal('1e3', 'USD')).toThrow(MoneyError);
    expect(() => parseDecimal('', 'USD')).toThrow(MoneyError);
  });

  it('round-trips through format and parse', () => {
    const original = money(1_234_567, 'USD');
    const rendered = format(original, 'en-US');
    // Intl output is presentation-only; verify the numeric path round-trips.
    expect(rendered).toContain('12,345.67');
    expect(parseDecimal('12345.67', 'USD').amountMinor).toBe(original.amountMinor);
  });
});

describe('rounding modes are exact integer arithmetic', () => {
  it('half-up rounds a true half away from zero', () => {
    // 2.5 minor units -> 3
    expect(applyBasisPoints(money(5, 'USD'), 5_000, 'half-up').amountMinor).toBe(3);
    // -2.5 minor units -> -3
    expect(applyBasisPoints(money(-5, 'USD'), 5_000, 'half-up').amountMinor).toBe(-3);
  });

  it('half-even rounds a true half to the even neighbour', () => {
    // 2.5 -> 2 (even), 3.5 -> 4 (even)
    expect(applyBasisPoints(money(5, 'USD'), 5_000, 'half-even').amountMinor).toBe(2);
    expect(applyBasisPoints(money(7, 'USD'), 5_000, 'half-even').amountMinor).toBe(4);
  });

  it('floor rounds toward negative infinity', () => {
    expect(applyBasisPoints(money(5, 'USD'), 5_000, 'floor').amountMinor).toBe(2);
    expect(applyBasisPoints(money(-5, 'USD'), 5_000, 'floor').amountMinor).toBe(-3);
  });

  it('ceil rounds toward positive infinity', () => {
    expect(applyBasisPoints(money(5, 'USD'), 5_000, 'ceil').amountMinor).toBe(3);
    expect(applyBasisPoints(money(-5, 'USD'), 5_000, 'ceil').amountMinor).toBe(-2);
  });

  it('trunc rounds toward zero', () => {
    expect(applyBasisPoints(money(5, 'USD'), 5_000, 'trunc').amountMinor).toBe(2);
    expect(applyBasisPoints(money(-5, 'USD'), 5_000, 'trunc').amountMinor).toBe(-2);
  });

  it('returns exact values when there is no remainder', () => {
    expect(applyBasisPoints(money(10_000, 'USD'), 2_000, 'half-up').amountMinor).toBe(2_000);
  });

  it('applies a percentage', () => {
    expect(applyPercent(money(10_000, 'USD'), 20).amountMinor).toBe(2_000);
    expect(applyPercent(money(19_999, 'USD'), 8.875).amountMinor).toBe(1_775);
  });

  it('rejects a non-finite rate', () => {
    expect(() => applyBasisPoints(money(100, 'USD'), Number.NaN)).toThrow(MoneyError);
    expect(() => applyBasisPoints(money(100, 'USD'), Number.POSITIVE_INFINITY)).toThrow(MoneyError);
  });
});

describe('allocate never loses a minor unit', () => {
  it('splits evenly and assigns the remainder deterministically', () => {
    const parts = allocate(money(1_000, 'USD'), [1, 1, 1]);
    expect(parts.map((p) => p.amountMinor)).toEqual([334, 333, 333]);
    expect(parts.reduce((a, p) => a + p.amountMinor, 0)).toBe(1_000);
  });

  it('respects unequal weights', () => {
    const parts = allocate(money(1_000, 'USD'), [1, 2, 3]);
    expect(parts.reduce((a, p) => a + p.amountMinor, 0)).toBe(1_000);
  });

  it('always sums back to the original across many cases', () => {
    for (let amount = 0; amount <= 500; amount += 1) {
      for (const weights of [
        [1, 1, 1],
        [1, 2, 3],
        [7, 11, 13],
        [1],
        [5, 5],
        [1, 1, 1, 1, 1, 1, 1],
      ]) {
        const parts = allocate(money(amount, 'USD'), weights);
        const total = parts.reduce((a, p) => a + p.amountMinor, 0);
        expect(total).toBe(amount);
        expect(parts).toHaveLength(weights.length);
      }
    }
  });

  it('preserves the sign for negative amounts', () => {
    const parts = allocate(money(-1_000, 'USD'), [1, 1, 1]);
    expect(parts.reduce((a, p) => a + p.amountMinor, 0)).toBe(-1_000);
    expect(parts.every((p) => p.amountMinor <= 0)).toBe(true);
  });

  it('rejects invalid weights', () => {
    expect(() => allocate(money(100, 'USD'), [])).toThrow(MoneyError);
    expect(() => allocate(money(100, 'USD'), [0, 0])).toThrow(MoneyError);
    expect(() => allocate(money(100, 'USD'), [1, -1])).toThrow(MoneyError);
    expect(() => allocate(money(100, 'USD'), [1.5, 1])).toThrow(MoneyError);
  });

  it('distributes leftover units to the largest fractional parts', () => {
    // 100 split 1:1:1 -> fractions are equal; index order breaks the tie.
    expect(allocate(money(100, 'USD'), [1, 1, 1]).map((p) => p.amountMinor)).toEqual([
      34, 33, 33,
    ]);
  });
});

describe('wire format', () => {
  it('serialises to the §11 shape', () => {
    expect(toDTO(money(1_250_000, 'USD'))).toEqual({
      amount_minor: 1_250_000,
      currency: 'USD',
    });
  });

  it('round-trips', () => {
    const original = money(99_999, 'GBP');
    expect(equals(fromDTO(toDTO(original)), original)).toBe(true);
  });

  it('validates on the way in', () => {
    expect(() => fromDTO({ amount_minor: 1.5, currency: 'USD' })).toThrow(MoneyError);
  });
});

describe('test 7 — zero floating-point drift', () => {
  it('exposes the naive float failure this design avoids', () => {
    // The classic: 0.1 + 0.2 !== 0.3 in binary floating point.
    expect(0.1 + 0.2).not.toBe(0.3);
  });

  it('adds 0.1 ten times to an exact 1.00', () => {
    let total = zero('USD');
    for (let i = 0; i < 10; i += 1) {
      total = add(total, money(10, 'USD'));
    }
    expect(total.amountMinor).toBe(100);
    expect(equals(total, parseDecimal('1.00', 'USD'))).toBe(true);
  });

  it('keeps a long chain of cents exact against the float baseline', () => {
    const cents = 19_999;
    let exact = zero('USD');
    let naive = 0;
    for (let i = 0; i < 1_000; i += 1) {
      exact = add(exact, money(cents, 'USD'));
      naive += cents / 100;
    }
    expect(exact.amountMinor).toBe(cents * 1_000);
    // The float version has already drifted away from the exact result.
    expect(naive).not.toBe(exact.amountMinor / 100);
  });

  it('computes tax without drift across many prices', () => {
    for (let minor = 1; minor <= 2_000; minor += 1) {
      const base = money(minor, 'USD');
      const tax = applyPercent(base, 20, 'half-up');
      // Exact expectation: floor((minor * 20 + 50) / 100) for half-up.
      const expected = Math.floor((minor * 20 + 50) / 100);
      expect(tax.amountMinor).toBe(expected);
    }
  });

  it('computes a multi-line total that equals the sum of its parts', () => {
    const lines = [
      multiplyBy(money(1_250_000, 'USD'), 1),
      multiplyBy(money(899_900, 'USD'), 1),
      multiplyBy(money(75_050, 'USD'), 2),
    ];
    const subtotal = sum(lines, 'USD');
    expect(subtotal.amountMinor).toBe(1_250_000 + 899_900 + 150_100);

    const tax = applyPercent(subtotal, 8.875, 'half-up');
    const shipping = money(5_000, 'USD');
    const total = add(add(subtotal, tax), shipping);

    // Every intermediate is an exact integer; nothing was rounded twice.
    expect(Number.isSafeInteger(total.amountMinor)).toBe(true);
    expect(total.amountMinor).toBe(subtotal.amountMinor + tax.amountMinor + 5_000);
  });

  it('never returns a fractional amount from any operation', () => {
    const base = money(123_457, 'USD');
    const results = [
      add(base, money(1, 'USD')),
      subtract(base, money(1, 'USD')),
      multiplyBy(base, 7),
      negate(base),
      abs(negate(base)),
      applyPercent(base, 33.333, 'half-up'),
      applyBasisPoints(base, 1, 'half-even'),
      ...allocate(base, [3, 5, 7]),
    ];
    for (const result of results) {
      expect(Number.isSafeInteger(result.amountMinor)).toBe(true);
    }
  });
});

describe('formatting', () => {
  it('renders with the currency symbol and correct decimals', () => {
    expect(format(money(1_250_000, 'USD'))).toBe('$12,500.00');
  });

  it('renders a zero-decimal currency without decimals', () => {
    expect(format(money(1_000, 'JPY'), 'en-US')).toBe('¥1,000');
  });

  it('respects the locale argument', () => {
    expect(format(money(1_250_000, 'EUR'), 'de-DE')).toContain('12.500,00');
  });
});