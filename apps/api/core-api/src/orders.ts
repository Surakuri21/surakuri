/**
 * Order BFF routes.
 *
 * Creating an order consumes a live hold (single slug per order),
 * prices it from server data, parks it at `pending_payment`, and
 * publishes `order.placed` to the outbox — one atomic intention.
 * Without a database these steps are sequential in code (an
 * orphan draft is possible on races; production does them in one
 * transaction). Capture (`paid`) arrives with the Stripe slice;
 * no route here can mark an order paid.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { IdSchema } from "@surakuri/contracts";
import {
  OrderError,
  OrderRecordSchema,
  createMemoryOrderStore,
  createOrder,
  transition,
} from "@surakuri/order";
import type { OrderStore } from "@surakuri/order";
import {
  ReservationError,
  commitReservation,
} from "@surakuri/reservation";
import type { ReservationStore } from "@surakuri/reservation";
import { createEnvelope } from "@surakuri/worker";
import type { OutboxEnvelope } from "@surakuri/worker";
import type { ServerPrice } from "@surakuri/cart";
import { validate } from "./validation.js";
import { ProblemError } from "./problem.js";

export interface OrderDeps {
  readonly orders: OrderStore;
  readonly holds: ReservationStore;
  readonly priceFor: (slug: string) => Promise<ServerPrice | undefined>;
  readonly publish: (event: OutboxEnvelope) => Promise<void>;
  readonly clock?: (() => Date) | undefined;
}

export function createDevOrderDeps(
  holds: ReservationStore,
  publish: (event: OutboxEnvelope) => Promise<void>,
): OrderDeps {
  return {
    orders: createMemoryOrderStore(),
    holds,
    priceFor: () =>
      Promise.reject(new Error("pricing not wired (pending IMS read path)")),
    publish,
  };
}

const CreateOrderBodySchema = z
  .object({
    customerId: IdSchema,
    reservationId: IdSchema,
    idempotencyKey: z.string().min(1),
  })
  .strict();

const OrderResponseSchema = z.object({
  order: OrderRecordSchema,
  eventId: IdSchema,
});

function toProblem(error: unknown): ProblemError {
  if (error instanceof OrderError) {
    switch (error.code) {
      case "conflict":
        return new ProblemError(409, "Idempotency conflict", {
          code: "idempotency-conflict",
          detail: error.message,
        });
      case "not-found":
        return new ProblemError(404, "Order not found", {
          code: "order-not-found",
        });
      default:
        return new ProblemError(409, "Invalid order transition", {
          code: "invalid-transition",
          detail: error.message,
        });
    }
  }
  if (error instanceof ReservationError) {
    switch (error.code) {
      case "not-found":
        return new ProblemError(404, "Reservation not found", {
          code: "reservation-not-found",
        });
      default:
        return new ProblemError(409, "Hold no longer available", {
          code: "hold-unavailable",
          detail: error.message,
        });
    }
  }
  throw error;
}

export function registerOrderRoutes(
  server: FastifyInstance,
  deps: OrderDeps,
): void {
  const now = (): Date => deps.clock?.() ?? new Date();

  server.post("/v1/orders", async (request, reply) => {
    const body = validate(CreateOrderBodySchema, request.body);
    const hold = await deps.holds.getById(body.reservationId);
    if (hold === undefined) {
      throw new ProblemError(404, "Reservation not found", {
        code: "reservation-not-found",
      });
    }
    let price: ServerPrice | undefined;
    try {
      price = await deps.priceFor(hold.slug);
    } catch {
      throw new ProblemError(503, "Pricing temporarily unavailable", {
        code: "pricing-unavailable",
      });
    }
    if (price === undefined) {
      throw new ProblemError(404, "Unknown product", {
        code: "unknown-product",
        detail: `No price for ${hold.slug}.`,
      });
    }
    try {
      const created = await createOrder(
        deps.orders,
        {
          customerId: body.customerId,
          reservationId: hold.id,
          items: [
            {
              slug: hold.slug,
              quantity: hold.quantity,
              unitMinor: price.amountMinor,
            },
          ],
          currency: price.currency,
          idempotencyKey: body.idempotencyKey,
        },
        now(),
      );
      const committed = await commitReservation(deps.holds, hold.id, now());
      if (committed.state !== "committed") {
        throw new ProblemError(409, "Hold no longer available", {
          code: "hold-unavailable",
        });
      }
      const pending = await transition(
        deps.orders,
        created.id,
        "pending_payment",
        now(),
      );
      const event = createEnvelope({
        type: "order.placed",
        aggregateId: pending.id,
        correlationId: request.correlationId,
        payload: {
          orderId: pending.id,
          totalMinor: pending.totalMinor,
          currency: pending.currency,
        },
      });
      await deps.publish(event);
      reply
        .code(201)
        .send(OrderResponseSchema.parse({ order: pending, eventId: event.eventId }));
    } catch (error) {
      throw toProblem(error);
    }
  });

  server.get("/v1/orders/:id", async (request, reply) => {
    const params = validate(z.object({ id: IdSchema }), request.params);
    const order = await deps.orders.getById(params.id);
    if (order === undefined) {
      throw new ProblemError(404, "Order not found", {
        code: "order-not-found",
      });
    }
    reply.send(OrderRecordSchema.parse(order));
  });

  server.post("/v1/orders/:id/cancel", async (request, reply) => {
    const params = validate(z.object({ id: IdSchema }), request.params);
    try {
      const order = await transition(deps.orders, params.id, "cancelled", now());
      reply.send(OrderRecordSchema.parse(order));
    } catch (error) {
      throw toProblem(error);
    }
  });
}
