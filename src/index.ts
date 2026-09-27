import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDb } from "./db.js";
import { loadDotEnv } from "./lib/env.js";
import { createLogger } from "./lib/logger.js";

loadDotEnv();
const config = loadConfig();
const logger = createLogger(config);

const db = createDb(config.DATABASE_URL);
const app = createApp(db);

const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT }, "agent-interface-kit listening (MCP at /mcp)");
});

function shutdown(signal: string): void {
  logger.info({ signal }, "shutting down");
  server.close(() => {
    void db.$disconnect().finally(() => process.exit(0));
  });
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
