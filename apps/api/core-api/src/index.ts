import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { loadConfig } from "./config.js";
import { buildServer } from "./server.js";
import {
  registerProductRoutes,
  unavailableSource,
} from "./products.js";
import { liveSupabaseSource } from "./supabase-catalog.js";
import { registerReservationRoutes } from "./reservations.js";
import { createMemoryStore } from "@surakuri/reservation";
import { registerCartRoutes } from "./cart.js";

function notWired(name: string): Promise<never> {
  return Promise.reject(new Error(`${name} not wired (pending IMS read path)`));
}

async function main(): Promise<void> {
  // Package-local .env for local dev only (gitignored). Real process
  // env always wins, so CI/production are unaffected.
  loadDotenv({ path: fileURLToPath(new URL("../.env", import.meta.url)) });
  const config = loadConfig(process.env);
  const server = buildServer();
  // Catalog reads: live Supabase when credentials are present,
  // otherwise fail closed with 503 (never an empty fake list).
  const serviceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  registerProductRoutes(
    server,
    serviceKey !== undefined
      ? liveSupabaseSource({
          url: config.SUPABASE_URL,
          serviceRoleKey: serviceKey,
        })
      : unavailableSource(),
  );
  // Dev-only single-process store: lost on restart, uncoordinated across
  // instances. Production uses Postgres (guard logic is unchanged).
  registerReservationRoutes(server, {
    store: createMemoryStore(),
    availabilityForSlug: () => notWired("availability"),
  });
  registerCartRoutes(server, {
    priceFor: () => notWired("pricing"),
  });
  try {
    await server.listen({ port: config.PORT, host: config.HOST });
  } catch (error) {
    server.log.error(error);
    process.exitCode = 1;
  }
}

void main();
