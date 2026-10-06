/**
 * Catalog BFF routes — the ONLY path browsers use to read products.
 *
 * The data source is injected: live Supabase reads land here once
 * migration 0001 is applied (owner-side). Until then `index.ts`
 * wires `unavailableSource()`, which fails closed with 503 —
 * an unwired catalog reads as unavailable, never as empty or fake.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { CatalogListResponseSchema } from "@surakuri/catalog";
import type { CatalogItem } from "@surakuri/catalog";
import { validate } from "./validation.js";
import { ProblemError } from "./problem.js";

export interface CatalogSource {
  listItems(args: {
    readonly limit: number;
    readonly cursor: string | null;
  }): Promise<{ readonly items: CatalogItem[]; readonly nextCursor: string | null }>;
}

/** Rejects loudly until the live source is wired. See above. */
export function unavailableSource(): CatalogSource {
  return {
    listItems: () =>
      Promise.reject(
        new Error("catalog source not wired (pending migration 0001 + RLS)"),
      ),
  };
}

const ListQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .default(20)
    .transform((value) => Math.min(Math.max(value, 1), 50)),
  cursor: z.string().min(1).optional(),
});

export function registerProductRoutes(
  server: FastifyInstance,
  source: CatalogSource,
): void {
  server.get("/v1/products", async (request, reply) => {
    const query = validate(ListQuerySchema, request.query);
    let page;
    try {
      page = await source.listItems({
        limit: query.limit,
        cursor: query.cursor ?? null,
      });
    } catch {
      throw new ProblemError(503, "Catalog temporarily unavailable", {
        code: "catalog-unavailable",
      });
    }
    reply.send(
      CatalogListResponseSchema.parse({
        items: page.items,
        nextCursor: page.nextCursor,
      }),
    );
  });
}
