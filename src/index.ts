import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createLogger } from "./lib/logger.js";

const config = loadConfig();
const logger = createLogger(config);

const app = createApp();

app.listen(config.PORT, () => {
  logger.info({ port: config.PORT }, "agent-interface-kit listening (MCP at /mcp)");
});
