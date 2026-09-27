import { describe, expect, it } from "vitest";

import {
  daysLeft,
  describeInstant,
  formatTunisTime,
  tunisToUtc,
  utcToTunis,
} from "../../src/lib/time.js";

describe("utcToTunis", () => {
  it("converts UTC to Tunis wall clock (UTC+1, no DST)", () => {
    const parts = utcToTunis(new Date("2026-01-15T12:00:00.000Z"));
    expect(parts).toMatchObject({ year: 2026, month: 1, day: 15, hour: 13, minute: 0 });
  });

  it("rolls over to the next Tunis day after 23:00 UTC", () => {
    const parts = utcToTunis(new Date("2026-06-30T23:30:00.000Z"));
    expect(parts).toMatchObject({ year: 2026, month: 7, day: 1, hour: 0, minute: 30 });
  });
});

describe("tunisToUtc", () => {
  it("converts Tunis wall clock to a UTC instant", () => {
    expect(tunisToUtc(2026, 1, 15, 13, 0).toISOString()).toBe("2026-01-15T12:00:00.000Z");
  });

  it("round-trips with utcToTunis across summer and winter", () => {
    for (const iso of ["2026-01-15T05:23:00.000Z", "2026-08-20T22:59:00.000Z"]) {
      const date = new Date(iso);
      const p = utcToTunis(date);
      expect(tunisToUtc(p.year, p.month, p.day, p.hour, p.minute, p.second).getTime()).toBe(
        date.getTime(),
      );
    }
  });
});

describe("daysLeft", () => {
  // now = 2026-09-27 23:30 UTC → already 2026-09-28 00:30 in Tunis.
  const now = new Date("2026-09-27T23:30:00.000Z");

  it("is 0 for a deadline later on the same Tunis calendar day", () => {
    expect(daysLeft(new Date("2026-09-28T12:00:00.000Z"), now)).toBe(0);
  });

  it("is 1 for a deadline on the next Tunis calendar day", () => {
    expect(daysLeft(new Date("2026-09-29T08:00:00.000Z"), now)).toBe(1);
  });

  it("is negative for a past Tunis calendar day", () => {
    expect(daysLeft(new Date("2026-09-27T10:00:00.000Z"), now)).toBe(-1);
  });

  it("uses Tunis days, not UTC days", () => {
    // Deadline at 2026-09-28 23:30 UTC is 2026-09-29 in Tunis → 1 day left,
    // even though in UTC it is the "same" day as now's UTC date + 1.
    expect(daysLeft(new Date("2026-09-28T23:30:00.000Z"), now)).toBe(1);
  });
});

describe("formatTunisTime", () => {
  it("renders a French Tunis date-time in 24h format", () => {
    const rendered = formatTunisTime(new Date("2026-01-15T12:00:00.000Z"));
    expect(rendered).toContain("janvier 2026");
    expect(rendered).toContain("13:00");
  });
});

describe("describeInstant", () => {
  it("pairs ISO UTC with the Tunis rendering and daysLeft", () => {
    const now = new Date("2026-09-27T10:00:00.000Z");
    const result = describeInstant(new Date("2026-09-30T09:00:00.000Z"), now);
    expect(result.utc).toBe("2026-09-30T09:00:00.000Z");
    expect(result.tunis).toContain("10:00");
    expect(result.daysLeft).toBe(3);
  });
});
