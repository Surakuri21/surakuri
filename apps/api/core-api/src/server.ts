/**
 * Fastify server skeleton.
 *
 * - `x-correlation-id` in → out (generated when absent). Joins logs,
 *   problem responses, and future outbox events.
 * - Unknown routes and unhandled errors return RFC 9457 problem+json,
 *   never a stack trace or HTML page.
 * - `GET /health` is the liveness probe (load balancer, CI smoke).
 */

import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { buildProblem, traceIdFor, ProblemError } from "./problem.js";

declare module "fastify" {
  interface FastifyRequest {
    correlationId: string;
  }
}

export function buildServer(): FastifyInstance {
  const server = Fastify({ logger: false });
  server.decorateRequest("correlationId", "");

  server.addHook("onRequest", (request, reply, done) => {
    const inbound = request.headers["x-correlation-id"];
    const correlationId =
      typeof inbound === "string" && inbound.length > 0 ? inbound : randomUUID();
    request.correlationId = correlationId;
    reply.header("x-correlation-id", correlationId);
    done();
  });

  server.get("/health", (_request, reply) => {
    reply.send({ status: "ok" });
  });

  server.setNotFoundHandler((request, reply) => {
    reply
      .code(404)
      .type("application/problem+json")
      .send(
        buildProblem(404, "Not found", {
          code: "not-found",
          detail: `No route for ${request.method} ${request.url}.`,
          traceId: traceIdFor(request.correlationId),
        }),
      );
  });

  server.setErrorHandler((error, request, reply) => {
    if (error instanceof ProblemError) {
      reply
        .code(error.status)
        .type("application/problem+json")
        .send(
          buildProblem(error.status, error.title, {
            ...(error.code === undefined ? {} : { code: error.code }),
            ...(error.detail === undefined ? {} : { detail: error.detail }),
            traceId: traceIdFor(request.correlationId),
          }),
        );
      return;
    }
    reply
      .code(500)
      .type("application/problem+json")
      .send(
        buildProblem(500, "Internal server error", {
          traceId: traceIdFor(request.correlationId),
        }),
      );
  });

  return server;
}
