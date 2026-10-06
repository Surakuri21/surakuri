import { loadConfig } from "./config.js";
import { buildServer } from "./server.js";
import { registerProductRoutes, unavailableSource } from "./products.js";
import { registerReservationRoutes } from "./reservations.js";
import { createMemoryStore } from "@surakuri/reservation";
import { registerCartRoutes } from "./cart.js";

function notWired(name: string): Promise<never> {
  return Promise.reject(new Error(`${name} not wired (pending IMS read path)`));
}

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const server = buildServer();
  registerProductRoutes(server, unavailableSource());
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
