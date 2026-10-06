/**
 * SURAKURI API contracts — the single source of truth for request/response
 * shapes shared between the storefront, the core-api, the worker, and the
 * ims-adapter.
 *
 * Design rules (Rule 1 — contracts before code; §62 API standards):
 *   - Every shape is defined with Zod for validation AND surfaced as OpenAPI.
 *   - Monetary values use the §11 wire shape { amount_minor, currency }.
 *   - Identifiers are UUIDs across domain boundaries.
 *   - Errors use RFC 9457 Problem Details.
 *   - Timestamps are RFC 3339; pagination is cursor-based.
 *
 * NOTE: these schemas are the Phase 0 skeleton. They encode the invariants
 * that money is integer minor units and that cross-domain ids are UUIDs,
 * but they do not yet model every luxury-watch attribute (see docs/ARCHITECTURE).
 */

import { z } from 'zod';

// ─── Primitives ─────────────────────────────────────────────────────────────

/** ISO 4217 currency code, three letters; normalised to uppercase. */
export const CurrencyCode = z
  .string()
  .length(3)
  .toUpperCase()
  .refine((s) => /^[A-Z]{3}$/.test(s), {
    message: 'Currency must be a 3-letter ISO 4217 code.',
  });

/** A monetary value in integer minor units — never a float. */
export const MoneySchema = z.object({
  amount_minor: z.number().int().nonnegative(),
  currency: CurrencyCode,
});

/** UUID identifier for cross-domain references. */
export const IdSchema = z.string().uuid();

/** A safe string datetime (RFC 3339). */
export const TimestampSchema = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), {
    message: 'Expected an RFC 3339 timestamp string.',
  })
  .transform((s) => new Date(s));

/** RFC 9457 Problem Details. */
export const ProblemDetailsSchema = z.object({
  type: z.string().url(),
  title: z.string().min(1),
  status: z.number().int().min(400).max(599),
  detail: z.string().optional(),
  instance: z.string().url().optional(),
  traceId: z.string().uuid().optional(),
  code: z.string().optional(),
});

// ─── Catalog domain ─────────────────────────────────────────────────────────

export const ProductCondition = z.enum([
  'new',
  'unworn',
  'certified_preowned',
  'vintage',
]);
export const ProductStatus = z.enum([
  'available',
  'reserved',
  'sold',
  'discontinued',
  'coming_soon',
]);

export const ProductSchema = z.object({
  id: IdSchema,
  brand: z.string().min(1),
  model: z.string().min(1),
  reference: z.string().min(1),
  slug: z.string().min(1).max(120),
  description: z.string().optional(),
  primaryImage: z.string().url().optional(),
  images: z.array(z.string().url()).default([]),
  movement: z.string().optional(),
  caseSizeMm: z.number().positive().max(100).optional(),
  caseMaterial: z.string().optional(),
  dial: z.string().optional(),
  bracelet: z.string().optional(),
  waterResistanceM: z.number().int().positive().max(10000).optional(),
  powerReserve: z.string().optional(),
  condition: ProductCondition.optional(),
  year: z.number().int().min(1900).max(new Date().getFullYear() + 5).optional(),
  box: z.boolean().default(false),
  papers: z.boolean().default(false),
  status: ProductStatus,
  price: MoneySchema,
  currency: CurrencyCode,
  // Availability is owned by the Reservation/IMS domains; here we expose only
  // the storefront-safe projection that the BFF shapes.
  isAvailable: z.boolean(),
});

export const ProductListItemSchema = ProductSchema.pick({
  id: true,
  brand: true,
  model: true,
  reference: true,
  slug: true,
  primaryImage: true,
  price: true,
  status: true,
  isAvailable: true,
}).strict();

export const ProductListResponseSchema = z.object({
  items: z.array(ProductListItemSchema),
  nextCursor: z.string().uuid().nullable().optional(),
  totalCount: z.number().int().nonnegative().optional(),
});

export const GetProductRequestSchema = z.object({
  slug: z.string().min(1),
});

// ─── Reservation domain (unit abstraction) ────────────────────────────────
// Shaped for the future serialized-unit model. Quantities currently flow as
// integer "available units" from the IMS mirror, so each request carries a
// quantity that the ims-adapter maps down to the SKU layer it owns.

export const ReserveItemSchema = z.object({
  /** Product slug as served to storefronts. */
  slug: z.string().min(1),
  quantity: z.number().int().positive().gte(1),
  /** Client idempotency key; the reservation owner must accept re-POSTs. */
  idempotencyKey: z.string().min(1),
});

export const CreateReservationRequestSchema = z.object({
  customerId: IdSchema,
  items: z.array(ReserveItemSchema).min(1),
});

export const ReservationState = z.enum([
  'pending',
  'active',
  'committed',
  'expired',
  'cancelled',
]);

export const ReservationSchema = z.object({
  id: IdSchema,
  customerId: IdSchema,
  state: ReservationState,
  expiresAt: TimestampSchema,
  items: z.array(ReserveItemSchema),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

// ─── Checkout domain ────────────────────────────────────────────────────────

export const CheckoutLineSchema = z.object({
  slug: z.string().min(1),
  quantity: z.number().int().positive(),
});

export const CreateCheckoutRequestSchema = z
  .object({
    currency: CurrencyCode,
    lines: z.array(CheckoutLineSchema).min(1),
    customer: z
      .object({
        email: z.string().email().optional(),
      })
      .strict()
      .optional(),
    idempotencyKey: z.string().min(1),
  })
  .strict();

export const CheckoutTotalsSchema = z.object({
  subtotal: MoneySchema,
  total: MoneySchema,
  currency: CurrencyCode,
});

export const CreateCheckoutResponseSchema = z.object({
  checkoutId: IdSchema,
  clientSecret: z.string(),
  totals: CheckoutTotalsSchema,
  expiresAt: TimestampSchema,
});

// ─── Auth domain ────────────────────────────────────────────────────────────

export const SignInRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export const SignInResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
});

// ─── OpenAPI skeleton ───────────────────────────────────────────────────────
// Derived from the schemas above so the doc cannot drift from the contract.

export function openapiDoc() {
  return {
    openapi: '3.1.0',
    info: {
      title: 'SURAKURI Core API',
      version: '0.1.0',
      description: 'Internal-facing commerce API for SURAKURI.',
    },
    servers: [{ url: '/api/v1' }],
    paths: {
      '/health': {
        get: {
          operationId: 'getHealth',
          responses: { '200': { description: 'OK' } },
        },
      },
      '/products/{slug}': {
        get: {
          operationId: 'getProduct',
          parameters: [
            { name: 'slug', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'Product',
              content: { 'application/json': { schema: '#/components/schemas/Product' } },
            },
            '404': { $ref: '#/components/responses/NotFound' },
          },
        },
      },
      '/checkout': {
        post: {
          operationId: 'createCheckout',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: '#/components/schemas/CreateCheckoutRequest' } },
          },
          responses: {
            '201': {
              description: 'Created',
              content: { 'application/json': { schema: '#/components/schemas/CreateCheckoutResponse' } },
            },
            '409': { $ref: '#/components/responses/Conflict' },
          },
        },
      },
    },
    components: {
      responses: {
        NotFound: {
          description: 'Resource not found',
          content: { 'application/problem+json': { schema: ProblemDetailsSchema } },
        },
        Conflict: {
          description: 'Conflict',
          content: { 'application/problem+json': { schema: ProblemDetailsSchema } },
        },
      },
      schemas: {
        Product: ProductSchema,
        CreateCheckoutRequest: CreateCheckoutRequestSchema,
        CreateCheckoutResponse: CreateCheckoutResponseSchema,
        ProblemDetails: ProblemDetailsSchema,
      },
    },
  };
}
