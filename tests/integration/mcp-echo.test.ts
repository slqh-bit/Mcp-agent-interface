import type { Server } from "node:http";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../src/app.js";

/**
 * Proves the Cycle 1 spike: an MCP client (the SDK's own) can connect over
 * Streamable HTTP, list tools and call `echo`. MCP Inspector cannot run
 * interactively on this device, so this test is the proof (plan §8, 1.2).
 */
describe("MCP echo spike (Streamable HTTP)", () => {
  let server: Server;
  let client: Client;
  let baseUrl: string;

  beforeAll(async () => {
    const app = createApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (typeof address !== "object" || address === null) throw new Error("no address");
    baseUrl = `http://127.0.0.1:${address.port}`;

    client = new Client({ name: "vitest-client", version: "0.0.1" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`)));
  });

  afterAll(async () => {
    await client.close();
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });

  it("serves /healthz", async () => {
    const res = await fetch(`${baseUrl}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("lists the echo tool", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("echo");
  });

  it("calls echo and gets the message back", async () => {
    const result = await client.callTool({
      name: "echo",
      arguments: { message: "bonjour TUNEPS" },
    });
    expect(result.content).toEqual([{ type: "text", text: "bonjour TUNEPS" }]);
    expect(result.structuredContent).toEqual({ message: "bonjour TUNEPS" });
  });

  it("rejects invalid input per the zod schema", async () => {
    const result = await client.callTool({ name: "echo", arguments: {} });
    expect(result.isError).toBe(true);
    const first = (result.content as { type: string; text: string }[])[0];
    expect(first?.type).toBe("text");
    expect(first?.text).toContain("Input validation error");
  });
});
