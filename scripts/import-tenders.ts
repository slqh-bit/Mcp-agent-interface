/**
 * Manual tender import (plan §7). The product works even if every automated
 * source is blocked.
 *
 * Usage: npm run import:tenders -- <file.csv|file.json>
 */
import { resolve } from "node:path";

import { loadConfig } from "../src/config.js";
import { createDb } from "../src/db.js";
import { createManualAdapter } from "../src/ingestion/adapters/manual.js";
import { runIngestion } from "../src/ingestion/run.js";
import { loadDotEnv } from "../src/lib/env.js";

async function main(): Promise<void> {
  const file = process.argv[2];
  if (!file || (!file.endsWith(".csv") && !file.endsWith(".json"))) {
    throw new Error("Usage: npm run import:tenders -- <file.csv|file.json>");
  }

  loadDotEnv();
  const config = loadConfig();
  const db = createDb(config.DATABASE_URL);

  try {
    const adapter = createManualAdapter(resolve(file));
    const run = await runIngestion(db, adapter);
    console.log(
      `Import ${run.status}: ${run.upserted}/${run.fetched} tenders upserted, ` +
        `${run.events} event(s), run id ${run.id}`,
    );
    const errors = run.errors as Array<{ reference?: string; error: string }>;
    for (const err of errors) {
      console.error(`  error${err.reference ? ` (${err.reference})` : ""}: ${err.error}`);
    }
    if (run.status === "FAILED") process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(`import:tenders failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
