/**
 * RFC 9457 Problem Details helpers.
 *
 * Every error response from core-api uses `application/problem+json`
 * shaped by `ProblemDetailsSchema` (contracts). `traceId` carries the
 * request's correlation ID so logs and client reports join up — but
 * only when it is a valid UUID, otherwise the schema would reject
 * our own error body.
 */

import { IdSchema } from "@surakuri/contracts";

export interface ProblemOptions {
  readonly code?: string | undefined;
  readonly detail?: string | undefined;
  readonly traceId?: string | undefined;
}

export function problemType(code: string): string {
  return `https://surakuri.example/problems/${code}`;
}

/** Returns the trace ID only when it is schema-valid (a UUID). */
export function traceIdFor(correlationId: string | undefined): string | undefined {
  if (correlationId === undefined) return undefined;
  return IdSchema.safeParse(correlationId).success ? correlationId : undefined;
}

export interface ProblemBody {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly code: string;
  readonly detail?: string | undefined;
  readonly traceId?: string | undefined;
}

export function buildProblem(
  status: number,
  title: string,
  options: ProblemOptions = {},
): ProblemBody {
  const code = options.code ?? "internal";
  return {
    type: problemType(code),
    title,
    status,
    code,
    ...(options.detail === undefined ? {} : { detail: options.detail }),
    ...(options.traceId === undefined ? {} : { traceId: options.traceId }),
  };
}

/** Error thrown by request handling; the server maps it to its status. */
export class ProblemError extends Error {
  public readonly status: number;
  public readonly title: string;
  public readonly code: string | undefined;
  public readonly detail: string | undefined;

  public constructor(status: number, title: string, options: ProblemOptions = {}) {
    super(options.detail ?? title);
    this.name = "ProblemError";
    this.status = status;
    this.title = title;
    this.code = options.code;
    this.detail = options.detail;
  }
}
