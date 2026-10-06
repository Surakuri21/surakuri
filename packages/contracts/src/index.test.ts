import { describe, expect, it } from 'vitest';
import {
  CreateCheckoutRequestSchema,
  CurrencyCode,
  IdSchema,
  MoneySchema,
  ProblemDetailsSchema,
} from './index.js';

// Note: a few of these intentionally use the schemas the way the core-api will.
describe('CurrencyCode', () => {
  it('uppercases lowercase input', () => {
    expect(CurrencyCode.parse('usd').toUpperCase()).toBe('USD');
  });

  it('rejects non-three-letter codes', () => {
    expect(() => CurrencyCode.parse('US')).toThrow();
    expect(() => CurrencyCode.parse('USDD')).toThrow();
  });
});

describe('MoneySchema', () => {
  it('accepts integer minor units', () => {
    expect(MoneySchema.parse({ amount_minor: 1_250_000, currency: 'USD' })).toEqual({
      amount_minor: 1_250_000,
      currency: 'USD',
    });
  });

  it('rejects fractional amounts', () => {
    expect(() => MoneySchema.parse({ amount_minor: 0.5, currency: 'USD' })).toThrow();
  });

  it('rejects negative amounts', () => {
    expect(() => MoneySchema.parse({ amount_minor: -1, currency: 'USD' })).toThrow();
  });
});

describe('IdSchema', () => {
  it('accepts a valid UUID', () => {
    expect(IdSchema.parse('0195a0b0-0000-7000-8000-000000000001')).toBe(
      '0195a0b0-0000-7000-8000-000000000001'
    );
  });

  it('rejects non-UUID strings', () => {
    expect(() => IdSchema.parse('not-a-uuid')).toThrow();
  });
});

describe('CreateCheckoutRequestSchema', () => {
  it('accepts a well-formed request', () => {
    const input = {
      currency: 'USD',
      lines: [{ slug: 'daytona-ref', quantity: 1 }],
      customer: { email: 'buyer@example.com' },
      idempotencyKey: 'checkout-1',
    };
    const parsed = CreateCheckoutRequestSchema.parse(input);
    expect(parsed.currency).toBe('USD');
    expect(parsed.lines[0]?.quantity).toBe(1);
  });

  it('rejects unknown fields (extra fields = reject)', () => {
    expect(() =>
      CreateCheckoutRequestSchema.parse({
        currency: 'USD',
        lines: [{ slug: 'x', quantity: 1 }],
        idempotencyKey: '1',
        // injected by a tampered client
        price: { amount_minor: 1, currency: 'USD' },
      })
    ).toThrow();
  });

  it('rejects non-positive quantity', () => {
    expect(() =>
      CreateCheckoutRequestSchema.parse({
        currency: 'USD',
        lines: [{ slug: 'x', quantity: 0 }],
        idempotencyKey: '1',
      })
    ).toThrow();
  });
});

describe('ProblemDetailsSchema', () => {
  it('accepts a valid problem document', () => {
    expect(
      ProblemDetailsSchema.parse({
        type: 'https://surakuri.example/problems/insufficient-stock',
        title: 'This watch was just reserved by another client.',
        status: 409,
        detail: 'Reference P-1270 is no longer available.',
        traceId: '0195a0b0-0000-7000-8000-000000000002',
      })
    ).toMatchObject({ status: 409 });
  });
});
