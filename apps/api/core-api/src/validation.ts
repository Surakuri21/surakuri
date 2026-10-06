/**
 * Zod request validation.
 *
 * Schemas come from `@surakuri/contracts` (contracts before code).
 * Invalid input throws a 400 `ProblemError` with the first issues
 * inline — the server's error handler turns it into problem+json.
 */

import type { z } from "zod";
import { ProblemError } from "./problem.js";

export function validate<Schema extends z.ZodTypeAny>(
  schema: Schema,
  data: unknown,
): z.infer<Schema> {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  const detail = result.error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("; ");
  throw new ProblemError(400, "Invalid request", {
    code: "validation-failed",
    detail,
  });
}
