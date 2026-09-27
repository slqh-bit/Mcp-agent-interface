import { describe, expect, it } from "vitest";

import {
  normaliseMillimes,
  normaliseText,
  parseTenderDate,
  tagSectors,
} from "../../src/ingestion/normalise.js";

describe("parseTenderDate", () => {
  it("reads DD/MM/YYYY as Africa/Tunis midnight → previous day 23:00 UTC", () => {
    expect(parseTenderDate("15/10/2026").toISOString()).toBe("2026-10-14T23:00:00.000Z");
  });

  it("reads DD/MM/YYYY HH:mm as Tunis wall clock", () => {
    expect(parseTenderDate("15/10/2026 12:00").toISOString()).toBe("2026-10-15T11:00:00.000Z");
  });

  it("reads ISO dates and datetimes without zone as Tunis wall clock", () => {
    expect(parseTenderDate("2026-10-15").toISOString()).toBe("2026-10-14T23:00:00.000Z");
    expect(parseTenderDate("2026-10-15 12:30").toISOString()).toBe("2026-10-15T11:30:00.000Z");
    expect(parseTenderDate("2026-10-15T12:30:00").toISOString()).toBe("2026-10-15T11:30:00.000Z");
  });

  it("honours explicit zones", () => {
    expect(parseTenderDate("2026-10-15T12:00:00Z").toISOString()).toBe("2026-10-15T12:00:00.000Z");
    expect(parseTenderDate("2026-10-15T12:00:00+01:00").toISOString()).toBe(
      "2026-10-15T11:00:00.000Z",
    );
  });

  it("has no DST edge: Tunisia is fixed UTC+1 since 2009, summer and winter alike", () => {
    // If DST were wrongly applied, a July date would shift by 2 hours.
    expect(parseTenderDate("15/07/2026 12:00").toISOString()).toBe("2026-07-15T11:00:00.000Z");
    expect(parseTenderDate("15/01/2026 12:00").toISOString()).toBe("2026-01-15T11:00:00.000Z");
  });

  it("rejects garbage instead of guessing", () => {
    expect(() => parseTenderDate("next Tuesday")).toThrow(/Invalid date/);
    expect(() => parseTenderDate("")).toThrow(/Invalid date/);
  });
});

describe("normaliseText", () => {
  it("trims and collapses whitespace, empty → undefined", () => {
    expect(normaliseText("  Acquisition   de  matériel \n informatique  ")).toBe(
      "Acquisition de matériel informatique",
    );
    expect(normaliseText("   ")).toBeUndefined();
    expect(normaliseText(null)).toBeUndefined();
    expect(normaliseText(undefined)).toBeUndefined();
  });
});

describe("normaliseMillimes", () => {
  it("converts TND to millimes BigInt", () => {
    expect(normaliseMillimes("12500.5")).toBe(12_500_500n);
    expect(normaliseMillimes("12 500,500")).toBe(12_500_500n);
    expect(normaliseMillimes("8 000")).toBe(8_000_000n);
  });

  it("passes empty values through as undefined", () => {
    expect(normaliseMillimes(null)).toBeUndefined();
    expect(normaliseMillimes(undefined)).toBeUndefined();
    expect(normaliseMillimes("")).toBeUndefined();
  });

  it("rejects invalid amounts", () => {
    expect(() => normaliseMillimes("douze mille")).toThrow(/Invalid TND/);
  });
});

describe("tagSectors", () => {
  it("tags French keywords, accent-insensitively", () => {
    expect(tagSectors("Fourniture et installation d'un système de vidéosurveillance")).toEqual([
      "cctv",
    ]);
    expect(tagSectors("Installation de cameras IP")).toEqual(["cctv"]);
    expect(tagSectors("Travaux de réhabilitation d'un centre de santé")).toEqual(["construction"]);
    expect(tagSectors("Prestation de gardiennage")).toEqual(["security"]);
  });

  it("tags Arabic keywords", () => {
    expect(tagSectors("توريد وتركيب منظومة مراقبة بالكاميرات")).toEqual(["cctv"]);
    expect(tagSectors("تركيب شبكة واي فاي")).toEqual(["network"]);
  });

  it("matches several tags across mixed FR/AR text", () => {
    const tags = tagSectors(
      "Installation de caméras de surveillance",
      "تركيب شبكة ألياف",
      "with câblage réseau",
    );
    expect(tags).toContain("cctv");
    expect(tags).toContain("network");
  });

  it("returns [] when nothing matches", () => {
    expect(tagSectors("Campagne de communication digitale")).toEqual([]);
    expect(tagSectors(undefined, undefined)).toEqual([]);
  });
});
