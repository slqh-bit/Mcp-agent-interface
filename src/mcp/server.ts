import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/**
 * Creates the MCP server and registers tools.
 *
 * Cycle 1 spike: a single `echo` tool to prove the Streamable HTTP wiring
 * end to end. All `@modelcontextprotocol/sdk` imports are confined to
 * `src/mcp/` (plan decision D1) so a future SDK migration touches only
 * this folder.
 */
export function createMcpServer(): McpServer {
  const server = new McpServer(
    { name: "agent-interface-kit", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.registerTool(
    "echo",
    {
      description: "Echoes the input message back. Connectivity spike tool.",
      inputSchema: { message: z.string().describe("The message to echo back") },
    },
    async ({ message }) => ({
      content: [{ type: "text", text: message }],
      structuredContent: { message },
    }),
  );

  return server;
}
