import type { Db } from "../db.js";
import { IngestionRunStatus, type IngestionRun } from "../generated/prisma/client.js";
import type { SourceAdapter } from "./adapter.js";
import { upsertTender } from "./upsert.js";

/**
 * Runs one adapter pass and records an IngestionRun row (plan §7): source,
 * timings, counts and per-row errors. One bad row never aborts the run —
 * it lands in `errors` and the run finishes PARTIAL.
 */
export async function runIngestion(db: Db, adapter: SourceAdapter): Promise<IngestionRun> {
  const run = await db.ingestionRun.create({ data: { source: adapter.id } });

  let fetched = 0;
  let upserted = 0;
  let events = 0;
  const errors: Array<{ reference?: string; error: string }> = [];

  try {
    for await (const raw of adapter.fetchChanged(new Date(0))) {
      fetched++;
      const reference = typeof raw["reference"] === "string" ? raw["reference"] : undefined;
      try {
        const normalised = adapter.parse(raw);
        const result = await upsertTender(db, normalised);
        upserted++;
        events += result.events.length;
      } catch (error) {
        errors.push({
          reference,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } catch (error) {
    // Adapter-level failure (file unreadable, invalid JSON, …).
    errors.push({ error: error instanceof Error ? error.message : String(error) });
  }

  const status =
    errors.length === 0
      ? IngestionRunStatus.SUCCESS
      : upserted === 0
        ? IngestionRunStatus.FAILED
        : IngestionRunStatus.PARTIAL;

  return db.ingestionRun.update({
    where: { id: run.id },
    data: { finishedAt: new Date(), fetched, upserted, events, errors, status },
  });
}
