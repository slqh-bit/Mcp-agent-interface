import type { Db } from "../db.js";
import { Prisma, TenderEventType } from "../generated/prisma/client.js";
import type { NormalisedTender } from "./adapter.js";
import { computeContentHash, diffTender, type TenderChange } from "./diff.js";

/**
 * Upsert one normalised tender (plan §7): dedupe by reference, upsert
 * Tender/Buyer/Lot/TenderDocument, and record TenderEvents from the diff.
 */

export interface UpsertResult {
  tenderId: string;
  created: boolean;
  events: TenderChange[];
}

export async function upsertTender(db: Db, tender: NormalisedTender): Promise<UpsertResult> {
  const buyer = await db.buyer.upsert({
    where: { name: tender.buyer.name },
    create: {
      name: tender.buyer.name,
      nameAr: tender.buyer.nameAr ?? null,
      type: tender.buyer.type,
      region: tender.buyer.region ?? null,
    },
    update: {
      nameAr: tender.buyer.nameAr ?? undefined,
      type: tender.buyer.type,
      region: tender.buyer.region ?? undefined,
    },
  });

  const contentHash = computeContentHash(tender);
  const existing = await db.tender.findUnique({ where: { reference: tender.reference } });

  if (!existing) {
    const created = await db.tender.create({
      data: {
        reference: tender.reference,
        source: tender.source,
        sourceUrl: tender.sourceUrl ?? null,
        buyerId: buyer.id,
        title: tender.title,
        titleAr: tender.titleAr ?? null,
        summary: tender.summary ?? null,
        procedureType: tender.procedureType,
        category: tender.category,
        cpvOrSector: tender.sectors,
        region: tender.region ?? null,
        publishedAt: tender.publishedAt ?? null,
        deadlineAt: tender.deadlineAt,
        openingAt: tender.openingAt ?? null,
        bidBondMillimes: tender.bidBondMillimes ?? null,
        status: tender.status,
        contentHash,
        lots: {
          create: tender.lots.map((l) => ({ ...l, bidBondMillimes: l.bidBondMillimes ?? null })),
        },
        documents: { create: tender.documents.map((d) => ({ ...d, url: d.url ?? null })) },
        events: {
          create: [{ type: TenderEventType.CREATED, after: { contentHash } }],
        },
      },
    });
    return {
      tenderId: created.id,
      created: true,
      events: [{ type: TenderEventType.CREATED, after: { contentHash } }],
    };
  }

  const changes = diffTender(existing, tender);
  if (changes.length === 0) {
    await db.tender.update({
      where: { id: existing.id },
      data: { lastSeenAt: new Date() },
    });
    return { tenderId: existing.id, created: false, events: [] };
  }

  await db.$transaction(async (tx) => {
    await tx.tender.update({
      where: { id: existing.id },
      data: {
        source: tender.source,
        sourceUrl: tender.sourceUrl ?? null,
        buyerId: buyer.id,
        title: tender.title,
        titleAr: tender.titleAr ?? null,
        summary: tender.summary ?? null,
        procedureType: tender.procedureType,
        category: tender.category,
        cpvOrSector: tender.sectors,
        region: tender.region ?? null,
        publishedAt: tender.publishedAt ?? null,
        deadlineAt: tender.deadlineAt,
        openingAt: tender.openingAt ?? null,
        bidBondMillimes: tender.bidBondMillimes ?? null,
        status: tender.status,
        contentHash,
        lastSeenAt: new Date(),
      },
    });
    // Lots and documents are replaced wholesale — they are cheap and the
    // source file is authoritative.
    await tx.lot.deleteMany({ where: { tenderId: existing.id } });
    if (tender.lots.length > 0) {
      await tx.lot.createMany({
        data: tender.lots.map((l) => ({
          tenderId: existing.id,
          number: l.number,
          title: l.title,
          bidBondMillimes: l.bidBondMillimes ?? null,
        })),
      });
    }
    await tx.tenderDocument.deleteMany({ where: { tenderId: existing.id } });
    if (tender.documents.length > 0) {
      await tx.tenderDocument.createMany({
        data: tender.documents.map((d) => ({
          tenderId: existing.id,
          kind: d.kind,
          title: d.title,
          url: d.url ?? null,
        })),
      });
    }
    await tx.tenderEvent.createMany({
      data: changes.map((c) => ({
        tenderId: existing.id,
        type: c.type,
        before: c.before as Prisma.InputJsonValue | undefined,
        after: c.after as Prisma.InputJsonValue | undefined,
      })),
    });
  });

  return { tenderId: existing.id, created: false, events: changes };
}
