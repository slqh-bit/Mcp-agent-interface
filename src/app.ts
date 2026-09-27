import express, { type Express } from "express";

import { handleMcpRequest } from "./mcp/transport.js";

export function createApp(): Express {
  const app = express();

  // Trivial liveness probe; full health/readiness checks are Cycle 7.
  app.get("/healthz", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.all("/mcp", express.json({ limit: "1mb" }), (req, res, next) => {
    handleMcpRequest(req, res).catch(next);
  });

  return app;
}
