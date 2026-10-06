/**
 * Runtime config, validated with Zod at startup.
 *
 * Fail fast: a missing SUPABASE_URL crashes the process here with a
 * readable error instead of surfacing as a mysterious 500 later.
 */

import { z } from "zod";

const ConfigSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  HOST: z.string().min(1).default("127.0.0.1"),
  SUPABASE_URL: z.string().url(),
});

export type ApiConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(env: {
  readonly [key: string]: string | undefined;
}): ApiConfig {
  return ConfigSchema.parse({
    PORT: env["PORT"],
    HOST: env["HOST"],
    SUPABASE_URL: env["SUPABASE_URL"],
  });
}
