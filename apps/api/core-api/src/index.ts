import { loadConfig } from "./config.js";
import { buildServer } from "./server.js";

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const server = buildServer();
  try {
    await server.listen({ port: config.PORT, host: config.HOST });
  } catch (error) {
    server.log.error(error);
    process.exitCode = 1;
  }
}

void main();
