import type { Server } from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { resetLastUsedThrottle } from "../../src/auth/tokens.js";
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
 * Bearer auth on /mcp (plan §8 Cycle 2 exit, §10 security checklist):
 * missing/invalid/revoked/expired → 401 JSON; a valid token reaches the MCP
 * layer; lastUsedAt is maintained; the stateless transport binds every
 * request to its own token (no server-side session to replay).
 */
interface ErrorBody {
  error: { code: string; message: string };
}

describe("auth on /mcp", () => {
  let db: Db;
  let server: Server;
  let baseUrl: string;
  let valid: TestTenantToken;
  let second: TestTenantToken;
  let revoked: TestTenantToken;
  let expired: TestTenantToken;

  const mcpInit = (headers: Record<string, string> = {}) =>
    fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...headers,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "vitest", version: "0.0.1" },
        },
      }),
    });

  beforeAll(async () => {
    db = testDb();
    valid = await createTenantWithToken(db, "auth-valid");
    second = await createTenantWithToken(db, "auth-second");
    revoked = await createTenantWithToken(db, "auth-revoked", { revoked: true });
    expired = await createTenantWithToken(db, "auth-expired", {
      expiresAt: new Date("2026-01-01T00:00:00Z"),
    });
    ({ server, baseUrl } = await listen(createApp(db)));
  });

  afterAll(async () => {
    await closeServer(server);
    for (const t of [valid, second, revoked, expired]) await deleteTenant(db, t.tenantId);
    await closeTestDb();
  });

  it("401 with a clear JSON error when the Authorization header is missing", async () => {
    const res = await mcpInit();
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain("Bearer");
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe("missing_token");
    expect(body.error.message).toMatch(/Authorization/);
  });

  it("401 on malformed and unknown tokens", async () => {
    const malformed = await mcpInit({ authorization: "Bearer not-a-token" });
    expect(malformed.status).toBe(401);
    expect(((await malformed.json()) as ErrorBody).error.code).toBe("malformed_token");

    const unknown = await mcpInit({
      authorization: `Bearer aik_live_${"x".repeat(32)}`,
    });
    expect(unknown.status).toBe(401);
    expect(((await unknown.json()) as ErrorBody).error.code).toBe("invalid_token");
  });

  it("401 on revoked and expired tokens", async () => {
    const revokedRes = await mcpInit({ authorization: `Bearer ${revoked.rawToken}` });
    expect(revokedRes.status).toBe(401);
    expect(((await revokedRes.json()) as ErrorBody).error.code).toBe("revoked_token");

    const expiredRes = await mcpInit({ authorization: `Bearer ${expired.rawToken}` });
    expect(expiredRes.status).toBe(401);
    expect(((await expiredRes.json()) as ErrorBody).error.code).toBe("expired_token");
  });

  it("accepts a valid token and answers the MCP initialize", async () => {
    resetLastUsedThrottle();
    const res = await mcpInit({ authorization: `Bearer ${valid.rawToken}` });
    expect(res.status).toBe(200);
    // Streamable HTTP answers as an SSE stream carrying the JSON-RPC result.
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const body = await res.text();
    expect(body).toContain('"serverInfo"');
    expect(body).toContain("agent-interface-kit");

    const tokenRow = await db.apiToken.findUnique({ where: { id: valid.tokenId } });
    expect(tokenRow?.lastUsedAt).not.toBeNull();
  });

  it("throttles lastUsedAt writes (one write per window)", async () => {
    resetLastUsedThrottle();
    await mcpInit({ authorization: `Bearer ${valid.rawToken}` });
    const first = (await db.apiToken.findUnique({ where: { id: valid.tokenId } }))!.lastUsedAt!;
    await mcpInit({ authorization: `Bearer ${valid.rawToken}` });
    const secondRead = (await db.apiToken.findUnique({ where: { id: valid.tokenId } }))!
      .lastUsedAt!;
    expect(secondRead.getTime()).toBe(first.getTime());
  });

  it("stateless binding: no server-side session exists, the bearer token is the only credential", async () => {
    // Every request is authenticated independently: token B works on its own,
    // regardless of any prior request made with token A.
    const resA = await mcpInit({ authorization: `Bearer ${valid.rawToken}` });
    expect(resA.status).toBe(200);
    const resB = await mcpInit({ authorization: `Bearer ${second.rawToken}` });
    expect(resB.status).toBe(200);

    // The stateless transport ignores Mcp-Session-Id entirely — there is no
    // session store, so a session "created under token A" cannot be replayed
    // with token B: the id is simply never read (request still answered 200,
    // authorized by token B alone).
    const forged = await mcpInit({
      authorization: `Bearer ${second.rawToken}`,
      "mcp-session-id": "session-created-under-token-A",
    });
    expect(forged.status).toBe(200);

    // And a session id without a valid token grants nothing: still 401.
    const sessionOnly = await mcpInit({ "mcp-session-id": "session-created-under-token-A" });
    expect(sessionOnly.status).toBe(401);
  });
});
