import type { Server } from "node:http";

import { generateToken } from "../../src/auth/tokens.js";
import { createDb, type Db } from "../../src/db.js";

/**
 * Shared helpers for integration tests against the real local Postgres
 * cluster. Each fixture uses unique slugs/references so test files can run in
 * parallel workers without truncating shared tables.
 */

let db: Db | undefined;

export function testDb(): Db {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not set. Integration tests need the local Postgres cluster " +
        "(see README: pg_ctl start + .env).",
    );
  }
  db ??= createDb(process.env.DATABASE_URL);
  return db;
}

export async function closeTestDb(): Promise<void> {
  await db?.$disconnect();
  db = undefined;
}

export interface TestTenantToken {
  tenantId: string;
  slug: string;
  rawToken: string;
  prefix: string;
  tokenId: string;
}

/** Create a tenant + valid token. `suffix` must be unique per test file. */
export async function createTenantWithToken(
  db: Db,
  suffix: string,
  overrides: { scopes?: string[]; expiresAt?: Date | null; revoked?: boolean } = {},
): Promise<TestTenantToken> {
  const tenant = await db.tenant.create({
    data: { name: `Test ${suffix}`, slug: `test-${suffix}` },
  });
  const generated = generateToken();
  const token = await db.apiToken.create({
    data: {
      tenantId: tenant.id,
      name: "test",
      prefix: generated.prefix,
      hash: generated.hash,
      scopes: overrides.scopes ?? ["tenders:read"],
      expiresAt: overrides.expiresAt ?? null,
      revokedAt: overrides.revoked ? new Date() : null,
    },
  });
  return {
    tenantId: tenant.id,
    slug: tenant.slug,
    rawToken: generated.token,
    prefix: generated.prefix,
    tokenId: token.id,
  };
}

/** Delete a tenant (cascades its tokens). */
export async function deleteTenant(db: Db, tenantId: string): Promise<void> {
  await db.tenant.delete({ where: { id: tenantId } });
}

/** Delete tenders by reference (cascades lots/documents/events). */
export async function deleteTenders(db: Db, references: string[]): Promise<void> {
  const tenders = await db.tender.findMany({
    where: { reference: { in: references } },
    select: { buyerId: true },
  });
  await db.tender.deleteMany({ where: { reference: { in: references } } });
  // Buyers are global; remove the ones this fixture created if now orphaned.
  for (const { buyerId } of tenders) {
    const remaining = await db.tender.count({ where: { buyerId } });
    if (remaining === 0) {
      await db.buyer.delete({ where: { id: buyerId } }).catch(() => {});
    }
  }
}

export async function listen(
  app: import("express").Express,
): Promise<{ server: Server; baseUrl: string }> {
  const server = await new Promise<Server>((resolvePromise) => {
    const s = app.listen(0, "127.0.0.1", () => resolvePromise(s));
  });
  const address = server.address();
  if (typeof address !== "object" || address === null) throw new Error("no address");
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

export function closeServer(server: Server): Promise<void> {
  return new Promise((resolvePromise, reject) =>
    server.close((err) => (err ? reject(err) : resolvePromise())),
  );
}
