import { pino } from "pino";

import type { Config } from "../config.js";

/**
 * Central logger. Redaction-ready: any future secret-bearing fields
 * (tokens, auth headers) are stripped here, never at call sites.
 */
export function createLogger(config: Pick<Config, "LOG_LEVEL" | "NODE_ENV">) {
  return pino({
    level: config.LOG_LEVEL,
    base: { service: "agent-interface-kit", env: config.NODE_ENV },
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "*.token",
        "*.apiToken",
        "*.authorization",
      ],
      censor: "[redacted]",
    },
  });
}

export type Logger = ReturnType<typeof createLogger>;
