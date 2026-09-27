import { afterAll, describe, expect, it } from "vitest";

import { DEMO_TENANT_SLUG, runSeed } from "../../prisma/seed.js";
import type { Db } from "../../src/db.js";
import { closeTestDb, testDb } from "../helpers/db.js";

/**
 * Seed (plan §8, 2.3): ~30 realistic synthetic tenders, demo tenant + demo
 * token, idempotent re-runs.
 */
describe("seed", () => {
  let db: Db;

  afterAll(async () => {
    // The seed data stays in the dev database on purpose (it IS the dev
    // catalogue); only the connection is closed.
    db = testDb();
    await closeTestDb();
  });

  it("loads the fixture tenders, demo tenant and demo token", async () => {
    db = testDb();
    const summary = await runSeed(db);

    expect(summary.tenders).toBeGreaterThanOrEqual(30);
    expect(summary.demoTokenPrefix.startsWith("aik_live_")).toBe(true);

    const tenders = await db.tender.findMany({
      where: { source: "seed" },
      include: { lots: true, documents: true, events: true, buyer: true },
    });
    expect(tenders).toHaveLength(summary.tenders);

    // Mix of buyer types, categories, statuses and regions.
    const buyerTypes = new Set(tenders.map((t) => t.buyer.type));
    expect(buyerTypes).toContain("MINISTRY");
    expect(buyerTypes).toContain("MUNICIPALITY");
    expect(buyerTypes).toContain("PUBLIC_COMPANY");
    expect(buyerTypes).toContain("ESTABLISHMENT");
    const categories = new Set(tenders.map((t) => t.category));
    expect(categories.size).toBe(4);
    const statuses = new Set(tenders.map((t) => t.status));
    expect(statuses).toContain("OPEN");
    expect(statuses).toContain("CLOSED");
    expect(statuses).toContain("CANCELLED");
    expect(tenders.some((t) => t.titleAr !== null)).toBe(true);
    expect(tenders.some((t) => t.lots.length > 0)).toBe(true);
    expect(tenders.some((t) => t.documents.length > 0)).toBe(true);
    expect(tenders.some((t) => t.events.some((e) => e.type === "DEADLINE_CHANGED"))).toBe(true);
    expect(tenders.some((t) => t.events.some((e) => e.type === "CANCELLED"))).toBe(true);

    // Deadlines span past and future relative to seeding time.
    const now = Date.now();
    expect(tenders.some((t) => t.deadlineAt.getTime() < now)).toBe(true);
    expect(tenders.some((t) => t.deadlineAt.getTime() > now)).toBe(true);

    // Demo tenant + usable demo token.
    const tenant = await db.tenant.findUniqueOrThrow({
      where: { slug: DEMO_TENANT_SLUG },
      include: { apiTokens: true },
    });
    expect(tenant.apiTokens.length).toBeGreaterThanOrEqual(1);
    expect(tenant.apiTokens[0]!.scopes).toContain("tenders:read");
  });

  it("is idempotent: a second run creates nothing and duplicates no events", async () => {
    db = testDb();
    const eventsBefore = await db.tenderEvent.count({ where: { tender: { source: "seed" } } });
    const summary = await runSeed(db);
    expect(summary.created).toBe(0);
    expect(summary.demoToken).toBeUndefined();
    const eventsAfter = await db.tenderEvent.count({ where: { tender: { source: "seed" } } });
    expect(eventsAfter).toBe(eventsBefore);
  });
});
