/**
 * Reservation BFF routes.
 *
 * Availability comes from the injected source (IMS read path) — the
 * client never states stock. Until the live source is wired,
 * creation fails closed with 503; holds, heartbeats, and cancels
 * against the dev store keep working for integration testing.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  CreateReservationRequestSchema,
  IdSchema,
} from "@surakuri/contracts";
import {
  ReservationError,
  ReservationRecordSchema,
  cancelReservation,
  heartbeat,
  reserve,
  sweep,
} from "@surakuri/reservation";
import type { ReservationStore } from "@surakuri/reservation";
import { validate } from "./validation.js";
import { ProblemError } from "./problem.js";

export interface ReservationDeps {
  readonly store: ReservationStore;
  readonly availabilityForSlug: (slug: string) => Promise<number>;
  readonly clock?: (() => Date) | undefined;
}

const IdBodySchema = z.object({ id: IdSchema }).strict();
const ReservationsResponseSchema = z.object({
  reservations: z.array(ReservationRecordSchema),
});

function toProblem(error: unknown): ProblemError {
  if (error instanceof ReservationError) {
    switch (error.code) {
      case "insufficient-stock":
        return new ProblemError(409, "Insufficient stock", {
          code: "insufficient-stock",
          detail: error.message,
        });
      case "conflict":
        return new ProblemError(409, "Idempotency conflict", {
          code: "idempotency-conflict",
          detail: error.message,
        });
      case "not-found":
        return new ProblemError(404, "Reservation not found", {
          code: "reservation-not-found",
        });
      case "already-settled":
        return new ProblemError(409, "Reservation already settled", {
          code: "reservation-settled",
          detail: error.message,
        });
    }
  }
  throw error;
}

export function registerReservationRoutes(
  server: FastifyInstance,
  deps: ReservationDeps,
): void {
  const now = (): Date => deps.clock?.() ?? new Date();

  server.post("/v1/reservations", async (request, reply) => {
    const body = validate(CreateReservationRequestSchema, request.body);
    const held = [];
    for (const item of body.items) {
      let available: number;
      try {
        available = await deps.availabilityForSlug(item.slug);
      } catch {
        throw new ProblemError(503, "Availability temporarily unavailable", {
          code: "availability-unavailable",
        });
      }
      try {
        held.push(
          reserve(
            deps.store,
            {
              customerId: body.customerId,
              slug: item.slug,
              quantity: item.quantity,
              idempotencyKey: item.idempotencyKey,
            },
            available,
            now(),
          ),
        );
      } catch (error) {
        throw toProblem(error);
      }
    }
    reply
      .code(201)
      .send(ReservationsResponseSchema.parse({ reservations: held }));
  });

  server.post("/v1/reservations/heartbeat", async (request, reply) => {
    const body = validate(IdBodySchema, request.body);
    try {
      const record = heartbeat(deps.store, body.id, now());
      reply.send(ReservationRecordSchema.parse(record));
    } catch (error) {
      throw toProblem(error);
    }
  });

  server.post("/v1/reservations/cancel", async (request, reply) => {
    const body = validate(IdBodySchema, request.body);
    try {
      const record = cancelReservation(deps.store, body.id, now());
      reply.send(ReservationRecordSchema.parse(record));
    } catch (error) {
      throw toProblem(error);
    }
  });

  server.post("/v1/reservations/sweep", async (_request, reply) => {
    reply.send({ expired: sweep(deps.store, now()) });
  });
}
