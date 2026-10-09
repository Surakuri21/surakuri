import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadConfig } from "./config.js";
import { buildServer } from "./server.js";
import {
  registerProductRoutes,
  unavailableSource,
} from "./products.js";
import { liveSupabaseSource } from "./supabase-catalog.js";
import { registerReservationRoutes } from "./reservations.js";
import {
  createMemoryStore,
  createSupabaseReservationStore,
} from "@surakuri/reservation";
import { registerCartRoutes } from "./cart.js";
import { createDevOrderDeps, registerOrderRoutes } from "./orders.js";
import {
  createMemoryOrderStore,
  createSupabaseOrderStore,
} from "@surakuri/order";
import {
  createSupabaseOutboxSink,
  type OutboxEnvelope,
} from "@surakuri/worker";

function notWired(name: string): Promise<never> {
  return Promise.reject(new Error(`${name} not wired (pending IMS read path)`));
}

function serviceClient(url: string, serviceRoleKey: string): SupabaseClient {
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
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
  // Stores: memory by default. Set SURAKURI_USE_SUPABASE_STORES=1
  // (with migrations 0003-0005 applied) to persist holds, orders,
  // and outbox events in Supabase instead.
  const supabase =
    process.env["SURAKURI_USE_SUPABASE_STORES"] === "1" &&
    serviceKey !== undefined
      ? serviceClient(config.SUPABASE_URL, serviceKey)
      : null;
  // Dev-only single-process store: lost on restart, uncoordinated across
  // instances. Production uses Postgres (guard logic is unchanged).
  const holdStore =
    supabase === null ? createMemoryStore() : createSupabaseReservationStore(supabase);
  registerReservationRoutes(server, {
    store: holdStore,
    availabilityForSlug: () => notWired("availability"),
  });
  registerCartRoutes(server, {
    priceFor: () => notWired("pricing"),
  });
  // Dev outbox sink: accumulates published envelopes in memory so the
  // order → event path executes end to end. With Supabase stores,
  // events persist in outbox_events instead (worker delivers).
  const outbox: OutboxEnvelope[] = [];
  registerOrderRoutes(
    server,
    supabase === null
      ? createDevOrderDeps(holdStore, (event) => {
          outbox.push(event);
          return Promise.resolve();
        })
      : {
          orders: createSupabaseOrderStore(supabase),
          holds: holdStore,
          priceFor: () => notWired("pricing"),
          publish: (event: OutboxEnvelope) =>
            createSupabaseOutboxSink(supabase).publish(event),
        },
  );
  try {
    await server.listen({ port: config.PORT, host: config.HOST });
  } catch (error) {
    server.log.error(error);
    process.exitCode = 1;
  }
}

void main();
