import { describe, expect, it } from "vitest";

import { formatTnd, millimesToTndString, tndToMillimes } from "../../src/lib/money.js";

const NNBSP = " "; // narrow no-break space, French thousands separator

describe("formatTnd", () => {
  it("formats millimes with French grouping and three decimals", () => {
    expect(formatTnd(12_500_000n)).toBe(`12${NNBSP}500,000 DT`);
  });

  it("formats zero", () => {
    expect(formatTnd(0n)).toBe("0,000 DT");
  });

  it("formats negative amounts", () => {
    expect(formatTnd(-1_500n)).toBe("-1,500 DT");
  });

  it("groups large amounts without floats", () => {
    expect(formatTnd(1_234_567_890_123n)).toBe(`1${NNBSP}234${NNBSP}567${NNBSP}890,123 DT`);
  });

  it("keeps sub-dinar amounts", () => {
    expect(formatTnd(250n)).toBe("0,250 DT");
  });
});

describe("tndToMillimes", () => {
  it("parses a plain decimal string", () => {
    expect(tndToMillimes("12500.5")).toBe(12_500_500n);
  });

  it("parses the French display form back (round-trip)", () => {
    expect(tndToMillimes(`12${NNBSP}500,500`)).toBe(12_500_500n);
    expect(tndToMillimes(formatTnd(987_654_321n))).toBe(987_654_321n);
  });

  it("parses three-decimal amounts exactly", () => {
    expect(tndToMillimes("0,001")).toBe(1n);
    expect(tndToMillimes("3.141")).toBe(3_141n);
  });

  it("parses numbers without float artefacts", () => {
    expect(tndToMillimes(0.1)).toBe(100n);
    expect(tndToMillimes(12.34)).toBe(12_340n);
  });

  it("parses bigints as whole dinars", () => {
    expect(tndToMillimes(7n)).toBe(7_000n);
  });

  it("rejects invalid input", () => {
    expect(() => tndToMillimes("abc")).toThrow(/Invalid TND amount/);
    expect(() => tndToMillimes("1.0001")).toThrow(/Invalid TND amount/);
    expect(() => tndToMillimes("")).toThrow(/Invalid TND amount/);
  });
});

describe("millimesToTndString", () => {
  it("renders the exact decimal value", () => {
    expect(millimesToTndString(12_500_500n)).toBe("12500.500");
    expect(millimesToTndString(-42n)).toBe("-0.042");
    expect(millimesToTndString(0n)).toBe("0.000");
  });
});
