import type { Request, Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { createMcpServer } from "./server.js";

/**
 * Stateless Streamable HTTP handler: one McpServer + transport pair per
 * request, torn down when the response closes. There is deliberately no
 * server-side session (sessionIdGenerator: undefined): the bearer token on
 * each request is the only credential, which makes session↔token binding
 * moot — a session id is never read, so one created under token A cannot be
 * reused with token B (see src/auth/middleware.ts and the auth tests).
 */
export async function handleMcpRequest(req: Request, res: Response): Promise<void> {
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  res.on("close", () => {
    void transport.close();
    void server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
    console.error("MCP request failed:", error);
  }
}
