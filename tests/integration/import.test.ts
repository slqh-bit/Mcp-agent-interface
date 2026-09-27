import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Db } from "../../src/db.js";
import { createManualAdapter } from "../../src/ingestion/adapters/manual.js";
import { runIngestion } from "../../src/ingestion/run.js";
import { closeTestDb, deleteTenders, testDb } from "../helpers/db.js";

/**
 * Full import flow against the real Postgres cluster (plan §7, §8 Cycle 2
 * exit): rows upserted, unchanged re-import produces no duplicate events,
 * a changed deadline produces DEADLINE_CHANGED, a row error → PARTIAL run.
 */

const REFS = ["T-IMPORT-001", "T-IMPORT-002"];

const CSV_HEADER =
  "reference,title,buyerName,buyerType,procedureType,category,region,publishedAt,deadlineAt,bidBondTnd,status,lots,documents";

function row(deadline: string, title = "Acquisition de serveurs", status = "open"): string {
  return [
    "T-IMPORT-001",
    title,
    "Municipalité de Test Import",
    "municipalité",
    "open",
    "fournitures",
    "Sfax",
    "01/09/2026 09:00",
    deadline,
    "5000",
    status,
    '[{"number":1,"title":"Serveurs","bidBondTnd":"3000"},{"number":2,"title":"Stockage","bidBondTnd":"2000"}]',
    '[{"kind":"avis","title":"Avis","url":"https://example.tn/avis.pdf"}]',
  ]
    .map((cell) => `"${cell.replace(/"/g, '""')}"`)
    .join(",");
}

const ROW2 =
  '"T-IMPORT-002","Prestation de nettoyage des locaux","Municipalité de Test Import","municipalité","open","services","Sfax","01/09/2026 09:00","12/11/2026 12:00","2500","open","",""';

describe("manual import flow", () => {
  let db: Db;
  let dir: string;

  beforeAll(async () => {
    db = testDb();
    dir = await mkdtemp(join(tmpdir(), "aik-import-"));
  });

  afterAll(async () => {
    await deleteTenders(db, REFS);
    await db.ingestionRun.deleteMany({ where: { source: "manual" } });
    await closeTestDb();
  });

  it("imports a CSV file: tenders, lots, documents, buyer and a run row", async () => {
    const file = join(dir, "tenders.csv");
    await writeFile(file, [CSV_HEADER, row("20/10/2026 12:00"), ROW2].join("\n"));

    const run = await runIngestion(db, createManualAdapter(file));
    expect(run.status).toBe("SUCCESS");
    expect(run.fetched).toBe(2);
    expect(run.upserted).toBe(2);
    expect(run.events).toBe(2); // one CREATED each
    expect(run.finishedAt).not.toBeNull();

    const tender = await db.tender.findUniqueOrThrow({
      where: { reference: "T-IMPORT-001" },
      include: { lots: true, documents: true, events: true, buyer: true },
    });
    expect(tender.title).toBe("Acquisition de serveurs");
    expect(tender.buyer.name).toBe("Municipalité de Test Import");
    expect(tender.buyer.type).toBe("MUNICIPALITY");
    expect(tender.deadlineAt.toISOString()).toBe("2026-10-20T11:00:00.000Z");
    expect(tender.bidBondMillimes).toBe(5_000_000n);
    expect(tender.lots).toHaveLength(2);
    expect(tender.documents).toHaveLength(1);
    expect(tender.events.map((e) => e.type)).toEqual(["CREATED"]);
  });

  it("re-importing the unchanged file creates no duplicate events", async () => {
    const file = join(dir, "tenders.csv");
    const run = await runIngestion(db, createManualAdapter(file));
    expect(run.status).toBe("SUCCESS");
    expect(run.events).toBe(0);

    const events = await db.tenderEvent.findMany({
      where: { tender: { reference: { in: REFS } } },
    });
    expect(events).toHaveLength(2); // still just the two CREATED
  });

  it("a changed deadline produces a DEADLINE_CHANGED event", async () => {
    const file = join(dir, "tenders-v2.csv");
    await writeFile(file, [CSV_HEADER, row("27/10/2026 12:00")].join("\n"));

    const run = await runIngestion(db, createManualAdapter(file));
    expect(run.events).toBe(1);

    const tender = await db.tender.findUniqueOrThrow({
      where: { reference: "T-IMPORT-001" },
      include: { events: { orderBy: { at: "asc" } } },
    });
    expect(tender.deadlineAt.toISOString()).toBe("2026-10-27T11:00:00.000Z");
    const types = tender.events.map((e) => e.type);
    expect(types).toEqual(["CREATED", "DEADLINE_CHANGED"]);
    const change = tender.events[1]!;
    expect(change.before).toEqual({ deadlineAt: "2026-10-20T11:00:00.000Z" });
    expect(change.after).toEqual({ deadlineAt: "2026-10-27T11:00:00.000Z" });
  });

  it("a cancellation produces a CANCELLED event", async () => {
    const file = join(dir, "tenders-v3.csv");
    await writeFile(
      file,
      [CSV_HEADER, row("27/10/2026 12:00", "Acquisition de serveurs", "annulé")].join("\n"),
    );

    const run = await runIngestion(db, createManualAdapter(file));
    expect(run.events).toBe(1);

    const tender = await db.tender.findUniqueOrThrow({
      where: { reference: "T-IMPORT-001" },
      include: { events: { orderBy: { at: "asc" } } },
    });
    expect(tender.status).toBe("CANCELLED");
    expect(tender.events.map((e) => e.type)).toEqual(["CREATED", "DEADLINE_CHANGED", "CANCELLED"]);
  });

  it("a broken row lands in errors and the run finishes PARTIAL", async () => {
    const file = join(dir, "broken.csv");
    await writeFile(
      file,
      [
        CSV_HEADER,
        // one valid row (unchanged T-IMPORT-002) + one with a bad date
        ROW2,
        '"T-IMPORT-BAD","Prestation inconnue","Municipalité de Test Import","municipalité","open","services","Sfax","","bientôt","","open","",""',
      ].join("\n"),
    );

    const run = await runIngestion(db, createManualAdapter(file));
    expect(run.status).toBe("PARTIAL");
    expect(run.fetched).toBe(2);
    expect(run.upserted).toBe(1);
    const errors = run.errors as Array<{ reference?: string; error: string }>;
    expect(errors).toHaveLength(1);
    expect(errors[0]!.reference).toBe("T-IMPORT-BAD");
    expect(errors[0]!.error).toMatch(/Invalid date/);
  });

  it("imports a JSON file too", async () => {
    const file = join(dir, "tenders.json");
    await writeFile(
      file,
      JSON.stringify([
        {
          reference: "T-IMPORT-001",
          title: "Acquisition de serveurs (relance)",
          buyerName: "Municipalité de Test Import",
          buyerType: "municipalité",
          category: "fournitures",
          deadlineAt: "2026-12-01 12:00",
          status: "open",
        },
      ]),
    );

    const run = await runIngestion(db, createManualAdapter(file));
    expect(run.status).toBe("SUCCESS");

    const tender = await db.tender.findUniqueOrThrow({
      where: { reference: "T-IMPORT-001" },
      include: { events: { orderBy: { at: "asc" } } },
    });
    expect(tender.status).toBe("OPEN");
    expect(tender.events.map((e) => e.type)).toContain("DEADLINE_CHANGED");
  });
});
