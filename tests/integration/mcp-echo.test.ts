import type { Server } from "node:http";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../src/app.js";
import type { Db } from "../../src/db.js";
import {
  closeServer,
  closeTestDb,
  createTenantWithToken,
  deleteTenant,
  listen,
  testDb,
  type TestTenantToken,
} from "../helpers/db.js";

/**
 * Proves the Cycle 1 spike, now behind Cycle 2 auth: an MCP client (the SDK's
 * own) with a valid bearer token can connect over Streamable HTTP, list tools
 * and call `echo`. MCP Inspector cannot run interactively on this device, so
 * this test is the proof (plan §8, 1.2).
 */
describe("MCP echo spike (Streamable HTTP)", () => {
  let db: Db;
  let server: Server;
  let client: Client;
  let baseUrl: string;
  let fixture: TestTenantToken;

  beforeAll(async () => {
    db = testDb();
    fixture = await createTenantWithToken(db, "echo");
    const app = createApp(db);
    ({ server, baseUrl } = await listen(app));

    client = new Client({ name: "vitest-client", version: "0.0.1" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
        requestInit: { headers: { authorization: `Bearer ${fixture.rawToken}` } },
      }),
    );
  });

  afterAll(async () => {
    await client.close();
    await closeServer(server);
    await deleteTenant(db, fixture.tenantId);
    await closeTestDb();
  });

  it("serves /healthz without a token", async () => {
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
