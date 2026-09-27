import express, { type Express } from "express";

import { bearerAuth } from "./auth/middleware.js";
import type { Db } from "./db.js";
import { handleMcpRequest } from "./mcp/transport.js";

export function createApp(db: Db): Express {
  const app = express();

  // Trivial liveness probe; full health/readiness checks are Cycle 7.
  app.get("/healthz", (_req, res) => {
    res.json({ status: "ok" });
  });

  // /mcp is behind bearer auth: missing/invalid/revoked/expired → 401 JSON.
  app.all("/mcp", express.json({ limit: "1mb" }), bearerAuth(db), (req, res, next) => {
    handleMcpRequest(req, res).catch(next);
  });

  return app;
}
