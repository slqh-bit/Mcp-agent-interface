import { describe, expect, it } from "vitest";

import { csvToRecords, parseCsv, parseManualRow } from "../../src/ingestion/adapters/manual.js";

describe("parseCsv", () => {
  it("parses simple rows", () => {
    expect(parseCsv("a,b,c\n1,2,3\n")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("handles quoted fields with commas, quotes and newlines", () => {
    expect(parseCsv('title,note\n"Fourniture, installation","dite ""urgente""\nsuite"\n')).toEqual([
      ["title", "note"],
      ["Fourniture, installation", 'dite "urgente"\nsuite'],
    ]);
  });

  it("strips a BOM and ignores CRLF and blank trailing lines", () => {
    expect(parseCsv("﻿a,b\r\n1,2\r\n\r\n")).toEqual([["a", "b"], ["1", "2"], [""]]);
  });
});

describe("csvToRecords", () => {
  it("maps rows onto headers and skips blank lines", () => {
    const records = csvToRecords("reference,title\n\nS1, Titre un \n");
    expect(records).toEqual([{ reference: "S1", title: " Titre un " }]);
  });
});

describe("parseManualRow", () => {
  const minimal = {
    reference: " S2026-00999 ",
    title: " Acquisition de caméras de surveillance ",
    buyerName: "Municipalité de Test",
    buyerType: "municipalité",
    deadlineAt: "20/10/2026 12:00",
  };

  it("normalises a minimal row (trim, Tunis date, auto sector tags, defaults)", () => {
    const t = parseManualRow(minimal);
    expect(t.reference).toBe("S2026-00999");
    expect(t.title).toBe("Acquisition de caméras de surveillance");
    expect(t.buyer.type).toBe("MUNICIPALITY");
    expect(t.procedureType).toBe("OPEN");
    expect(t.category).toBe("SUPPLIES");
    expect(t.status).toBe("OPEN");
    expect(t.source).toBe("manual");
    expect(t.deadlineAt.toISOString()).toBe("2026-10-20T11:00:00.000Z");
    expect(t.sectors).toEqual(["cctv"]);
    expect(t.lots).toEqual([]);
    expect(t.documents).toEqual([]);
  });

  it("maps French/Arabic enum synonyms and money", () => {
    const t = parseManualRow({
      ...minimal,
      buyerType: "وزارة",
      procedureType: "استشارة",
      category: "اشغال",
      status: "annulé",
      bidBondTnd: "12 500,500",
    });
    expect(t.buyer.type).toBe("MINISTRY");
    expect(t.procedureType).toBe("CONSULTATION");
    expect(t.category).toBe("WORKS");
    expect(t.status).toBe("CANCELLED");
    expect(t.bidBondMillimes).toBe(12_500_500n);
  });

  it("parses lots and documents from JSON strings (CSV) and arrays (JSON)", () => {
    const fromCsv = parseManualRow({
      ...minimal,
      lots: '[{"number":1,"title":"Lot A","bidBondTnd":"1000"}]',
      documents: '[{"kind":"avis","title":"Avis","url":"https://example.tn/a.pdf"}]',
    });
    expect(fromCsv.lots).toEqual([{ number: 1, title: "Lot A", bidBondMillimes: 1_000_000n }]);
    expect(fromCsv.documents).toEqual([
      { kind: "avis", title: "Avis", url: "https://example.tn/a.pdf" },
    ]);

    const fromJson = parseManualRow({
      ...minimal,
      lots: [{ number: 2, title: "Lot B" }],
      documents: [{ kind: "avis", title: "Avis" }],
    });
    expect(fromJson.lots).toEqual([{ number: 2, title: "Lot B", bidBondMillimes: undefined }]);
    expect(fromJson.documents[0]!.url).toBeUndefined();
  });

  it("honours explicit sectors over auto-tagging", () => {
    const t = parseManualRow({ ...minimal, sectors: "network, IT" });
    expect(t.sectors).toEqual(["network", "it"]);
  });

  it("fails loudly on missing reference, bad date, bad enum", () => {
    expect(() => parseManualRow({ ...minimal, reference: "" })).toThrow(/reference/);
    expect(() => parseManualRow({ ...minimal, deadlineAt: "bientôt" })).toThrow(/Invalid date/);
    expect(() => parseManualRow({ ...minimal, category: "n'importe quoi" })).toThrow(/category/);
  });
});
