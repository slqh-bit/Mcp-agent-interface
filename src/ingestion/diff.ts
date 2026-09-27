import { createHash } from "node:crypto";

import { TenderEventType } from "../generated/prisma/enums.js";
import type { NormalisedTender } from "./adapter.js";

/**
 * Change detection (plan §7): a stable contentHash over the meaningful fields
 * detects changes between imports; diffs become TenderEvent rows
 * (CREATED / DEADLINE_CHANGED / AMENDED / CANCELLED).
 */

type Hashable = null | boolean | number | string | Hashable[] | { [key: string]: Hashable };

function stable(value: Hashable): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const entries = Object.keys(value)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stable(value[k]!)}`);
  return `{${entries.join(",")}}`;
}

/** Fields that define "the tender changed" — timestamps/ids excluded. */
function hashPayload(t: NormalisedTender): Hashable {
  return {
    reference: t.reference,
    title: t.title,
    titleAr: t.titleAr ?? null,
    summary: t.summary ?? null,
    procedureType: t.procedureType,
    category: t.category,
    sectors: [...t.sectors].sort(),
    region: t.region ?? null,
    buyerName: t.buyer.name,
    publishedAt: t.publishedAt?.toISOString() ?? null,
    deadlineAt: t.deadlineAt.toISOString(),
    openingAt: t.openingAt?.toISOString() ?? null,
    bidBondMillimes: t.bidBondMillimes?.toString() ?? null,
    status: t.status,
    lots: t.lots.map((l) => ({
      number: l.number,
      title: l.title,
      bidBondMillimes: l.bidBondMillimes?.toString() ?? null,
    })),
    documents: t.documents.map((d) => ({ kind: d.kind, title: d.title, url: d.url ?? null })),
  };
}

export function computeContentHash(t: NormalisedTender): string {
  return createHash("sha256")
    .update(stable(hashPayload(t)), "utf8")
    .digest("hex");
}

export interface TenderChange {
  type: (typeof TenderEventType)[keyof typeof TenderEventType];
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

export interface ExistingTenderSnapshot {
  contentHash: string;
  deadlineAt: Date;
  status: string;
}

/**
 * Diff an existing tender against its freshly normalised version.
 * Returns [] when nothing changed (identical contentHash → no events: a
 * re-imported unchanged file must not duplicate events).
 *
 * CANCELLED wins over everything: a cancellation is reported on its own.
 * A deadline change emits DEADLINE_CHANGED; any other field change (title,
 * lots, documents, …) additionally emits AMENDED.
 */
export function diffTender(
  existing: ExistingTenderSnapshot,
  next: NormalisedTender,
): TenderChange[] {
  const nextHash = computeContentHash(next);
  if (existing.contentHash === nextHash) return [];

  if (existing.status !== "CANCELLED" && next.status === "CANCELLED") {
    return [
      {
        type: TenderEventType.CANCELLED,
        before: { status: existing.status },
        after: { status: next.status },
      },
    ];
  }

  const changes: TenderChange[] = [];
  const deadlineChanged = existing.deadlineAt.getTime() !== next.deadlineAt.getTime();
  if (deadlineChanged) {
    changes.push({
      type: TenderEventType.DEADLINE_CHANGED,
      before: { deadlineAt: existing.deadlineAt.toISOString() },
      after: { deadlineAt: next.deadlineAt.toISOString() },
    });
  }

  const deadlineIsOnlyChange =
    deadlineChanged &&
    computeContentHash({ ...next, deadlineAt: existing.deadlineAt }) === existing.contentHash;
  if (!deadlineIsOnlyChange) {
    changes.push({
      type: TenderEventType.AMENDED,
      before: { contentHash: existing.contentHash },
      after: { contentHash: nextHash },
    });
  }

  return changes;
}
