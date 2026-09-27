import { describe, expect, it } from "vitest";

import type { NormalisedTender } from "../../src/ingestion/adapter.js";
import { computeContentHash, diffTender } from "../../src/ingestion/diff.js";

function baseTender(overrides: Partial<NormalisedTender> = {}): NormalisedTender {
  return {
    reference: "T-001",
    source: "manual",
    buyer: { name: "Municipalité de Test", type: "MUNICIPALITY" },
    title: "Fourniture de matériel",
    procedureType: "OPEN",
    category: "SUPPLIES",
    sectors: ["it"],
    deadlineAt: new Date("2026-10-20T11:00:00.000Z"),
    status: "OPEN",
    lots: [],
    documents: [],
    ...overrides,
  };
}

function snapshotOf(t: NormalisedTender) {
  return { contentHash: computeContentHash(t), deadlineAt: t.deadlineAt, status: t.status };
}

describe("computeContentHash", () => {
  it("is stable regardless of key insertion order and sector order", () => {
    const a = baseTender();
    const b = baseTender({ sectors: ["it"] });
    expect(computeContentHash(a)).toBe(computeContentHash(b));
    expect(computeContentHash(a)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when a meaningful field changes", () => {
    expect(computeContentHash(baseTender())).not.toBe(
      computeContentHash(baseTender({ title: "Autre titre" })),
    );
  });
});

describe("diffTender", () => {
  it("returns no events when nothing changed", () => {
    const t = baseTender();
    expect(diffTender(snapshotOf(t), t)).toEqual([]);
  });

  it("emits DEADLINE_CHANGED when only the deadline moved", () => {
    const before = baseTender();
    const after = baseTender({ deadlineAt: new Date("2026-10-27T11:00:00.000Z") });
    const changes = diffTender(snapshotOf(before), after);
    expect(changes).toEqual([
      {
        type: "DEADLINE_CHANGED",
        before: { deadlineAt: "2026-10-20T11:00:00.000Z" },
        after: { deadlineAt: "2026-10-27T11:00:00.000Z" },
      },
    ]);
  });

  it("emits AMENDED when another field changed", () => {
    const before = baseTender();
    const after = baseTender({ title: "Fourniture de matériel informatique (rectifié)" });
    const changes = diffTender(snapshotOf(before), after);
    expect(changes).toHaveLength(1);
    expect(changes[0]!.type).toBe("AMENDED");
  });

  it("emits DEADLINE_CHANGED and AMENDED when both moved", () => {
    const before = baseTender();
    const after = baseTender({
      deadlineAt: new Date("2026-10-27T11:00:00.000Z"),
      lots: [{ number: 1, title: "Lot unique" }],
    });
    const types = diffTender(snapshotOf(before), after).map((c) => c.type);
    expect(types).toEqual(["DEADLINE_CHANGED", "AMENDED"]);
  });

  it("emits CANCELLED alone when the tender is cancelled", () => {
    const before = baseTender();
    const after = baseTender({
      status: "CANCELLED",
      deadlineAt: new Date("2026-10-27T11:00:00.000Z"),
    });
    expect(diffTender(snapshotOf(before), after)).toEqual([
      { type: "CANCELLED", before: { status: "OPEN" }, after: { status: "CANCELLED" } },
    ]);
  });

  it("does not re-report CANCELLED for an already-cancelled tender", () => {
    const before = baseTender({ status: "CANCELLED" });
    const after = baseTender({ status: "CANCELLED", title: "Autre titre" });
    const types = diffTender(snapshotOf(before), after).map((c) => c.type);
    expect(types).toEqual(["AMENDED"]);
  });
});
