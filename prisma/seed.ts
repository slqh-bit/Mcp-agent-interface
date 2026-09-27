/**
 * Seed (plan §8, 2.3): demo tenant + demo token + the fixture tenders.
 *
 * The ~30 fixtures in `prisma/fixtures/tenders.json` are REALISTIC but
 * clearly SYNTHETIC — Phase 0.4's real-tender collection has not happened
 * yet. They go through the same parse + upsert pipeline as the manual
 * adapter, so the seed doubles as an end-to-end ingestion check.
 *
 * The raw demo token is printed once, for local testing only.
 *
 * Usage: npm run seed    (idempotent — re-running updates, never duplicates)
 */
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { SCOPES } from "../src/auth/scopes.js";
import { generateToken } from "../src/auth/tokens.js";
import { loadConfig } from "../src/config.js";
import { createDb, type Db } from "../src/db.js";
import type { RawTender } from "../src/ingestion/adapter.js";
import { parseManualRow } from "../src/ingestion/adapters/manual.js";
import { upsertTender } from "../src/ingestion/upsert.js";
import { TenderEventType, Prisma, type Tender } from "../src/generated/prisma/client.js";
import { loadDotEnv } from "../src/lib/env.js";

export const DEMO_TENANT_SLUG = "demo";
export const DEMO_TOKEN_NAME = "demo-local";

interface FixtureEvent {
  type: keyof typeof TenderEventType;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  at: string;
}

type FixtureTender = RawTender & { events?: FixtureEvent[] };

export interface SeedSummary {
  tenders: number;
  created: number;
  demoToken?: string; // raw token — only present when (re)created
  demoTokenPrefix: string;
}

export async function runSeed(db: Db, fixturesPath?: string): Promise<SeedSummary> {
  const fixturesFile =
    fixturesPath ?? join(dirname(fileURLToPath(import.meta.url)), "fixtures", "tenders.json");
  const fixtures = JSON.parse(await readFile(fixturesFile, "utf8")) as FixtureTender[];

  const tenant = await db.tenant.upsert({
    where: { slug: DEMO_TENANT_SLUG },
    create: { name: "Démo SARL", slug: DEMO_TENANT_SLUG, locale: "fr" },
    update: {},
  });

  let demoToken: string | undefined;
  let existingDemo = await db.apiToken.findFirst({
    where: { tenantId: tenant.id, name: DEMO_TOKEN_NAME, revokedAt: null },
  });
  if (!existingDemo) {
    const generated = generateToken();
    existingDemo = await db.apiToken.create({
      data: {
        tenantId: tenant.id,
        name: DEMO_TOKEN_NAME,
        prefix: generated.prefix,
        hash: generated.hash,
        scopes: [...SCOPES],
      },
    });
    demoToken = generated.token;
  }

  let created = 0;
  for (const fixture of fixtures) {
    const { events, ...row } = fixture;
    const normalised = parseManualRow(row);
    const result = await upsertTender(db, normalised);
    if (result.created) {
      created++;
      // Amendment history fixtures (rectificatifs) are seeded as events with
      // their own timestamps, only on first insert — never duplicated.
      for (const event of events ?? []) {
        await db.tenderEvent.create({
          data: {
            tenderId: result.tenderId,
            type: event.type,
            before: event.before as Prisma.InputJsonValue | undefined,
            after: event.after as Prisma.InputJsonValue | undefined,
            at: new Date(event.at),
          },
        });
      }
    }
  }

  return { tenders: fixtures.length, created, demoToken, demoTokenPrefix: existingDemo.prefix };
}

async function main(): Promise<void> {
  loadDotEnv();
  const config = loadConfig();
  const db = createDb(config.DATABASE_URL);

  try {
    const summary = await runSeed(db);
    const tenderCount: Tender[] = await db.tender.findMany({ where: { source: "seed" } });
    console.log(
      `Seed complete: ${summary.created} created, ${tenderCount.length}/${summary.tenders} seed tenders in catalogue.`,
    );
    console.log(`Demo tenant: "${DEMO_TENANT_SLUG}", token prefix ${summary.demoTokenPrefix}…`);
    if (summary.demoToken) {
      console.log("");
      console.log("Demo token (local testing only — shown once, store it now):");
      console.log("");
      console.log(`  ${summary.demoToken}`);
    } else {
      console.log("Demo token already exists; its raw value is not recoverable (hash only).");
    }
  } finally {
    await db.$disconnect();
  }
}

// Run as a script only when invoked directly (tests import runSeed instead).
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    console.error(`seed failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
