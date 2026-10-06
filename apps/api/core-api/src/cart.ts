/**
 * Cart pricing route — stateless preview, server prices only.
 *
 * The request carries slugs and quantities; unit prices come from
 * the injected source (catalog read path). There is no field in
 * which a client could submit a price, by construction.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { CartError, priceCart } from "@surakuri/cart";
import type { ServerPrice } from "@surakuri/cart";
import { validate } from "./validation.js";
import { ProblemError } from "./problem.js";

const PriceRequestSchema = z
  .object({
    lines: z
      .array(
        z
          .object({
            slug: z.string().min(1),
            quantity: z.number().int().positive(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

const PriceResponseSchema = z.object({
  lines: z.array(
    z
      .object({
        slug: z.string(),
        quantity: z.number().int().positive(),
        unitMinor: z.number().int().nonnegative(),
        lineMinor: z.number().int().nonnegative(),
        currency: z.string().length(3),
      })
      .strict(),
  ),
  totalMinor: z.number().int().nonnegative(),
  currency: z.string().length(3),
});

export interface CartDeps {
  readonly priceFor: (slug: string) => Promise<ServerPrice | undefined>;
}

export function registerCartRoutes(
  server: FastifyInstance,
  deps: CartDeps,
): void {
  server.post("/v1/cart/price", async (request, reply) => {
    const body = validate(PriceRequestSchema, request.body);
    const prices = new Map<string, ServerPrice>();
    try {
      for (const line of body.lines) {
        if (!prices.has(line.slug)) {
          const price = await deps.priceFor(line.slug);
          if (price === undefined) {
            throw new CartError(
              "unknown-product",
              `Unknown product ${line.slug}.`,
            );
          }
          prices.set(line.slug, price);
        }
      }
    } catch (error) {
      if (error instanceof CartError) {
        throw new ProblemError(404, "Unknown product", {
          code: "unknown-product",
          detail: error.message,
        });
      }
      throw new ProblemError(503, "Pricing temporarily unavailable", {
        code: "pricing-unavailable",
      });
    }
    try {
      const cart = priceCart(body.lines, (slug) => prices.get(slug));
      reply.send(PriceResponseSchema.parse(cart));
    } catch (error) {
      if (error instanceof CartError) {
        throw new ProblemError(400, "Invalid cart", {
          code: "invalid-cart",
          detail: error.message,
        });
      }
      throw error;
    }
  });
}
