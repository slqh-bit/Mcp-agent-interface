/**
 * Time helpers for the Africa/Tunis timezone (plan §5.3).
 *
 * All timestamps are stored in UTC. Tool outputs include both ISO UTC and a
 * human-readable Tunis time, and "days left" is computed on Tunis calendar
 * days. Tunisia has no DST since 2009, so Tunis is always UTC+1.
 */

export const TUNIS_TIMEZONE = "Africa/Tunis";

/** Tunisia abolished DST in 2009: fixed UTC+1, in milliseconds. */
export const TUNIS_OFFSET_MS = 60 * 60 * 1000;

export interface TunisParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number; // 0-59
  second: number; // 0-59
}

const tunisFormatter = new Intl.DateTimeFormat("fr-TN", {
  timeZone: TUNIS_TIMEZONE,
  dateStyle: "full",
  timeStyle: "short",
  hourCycle: "h23",
});

const partsFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: TUNIS_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** Format an instant as a human-readable French Tunis date-time. */
export function formatTunisTime(date: Date): string {
  return tunisFormatter.format(date);
}

/** Break an instant down into its Africa/Tunis wall-clock components. */
export function utcToTunis(date: Date): TunisParts {
  const parts = partsFormatter.formatToParts(date);
  const get = (type: string): number => {
    const part = parts.find((p) => p.type === type);
    if (!part) throw new Error(`Intl part missing: ${type}`);
    return Number(part.value);
  };
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/**
 * Convert Tunis wall-clock components to a UTC instant.
 * Month is 1-based. Tunis is fixed UTC+1 (no DST), so this is exact.
 */
export function tunisToUtc(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): Date {
  return new Date(Date.UTC(year, month - 1, day, hour, minute, second) - TUNIS_OFFSET_MS);
}

/** Calendar-day serial number of an instant in Tunis time. */
function tunisDayNumber(date: Date): number {
  const { year, month, day } = utcToTunis(date);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

/**
 * Whole calendar days from `now` to `deadline`, counted in Tunis time.
 * A deadline later today is 0, tomorrow is 1, yesterday is -1.
 */
export function daysLeft(deadline: Date, now: Date = new Date()): number {
  return tunisDayNumber(deadline) - tunisDayNumber(now);
}

/** ISO UTC string paired with the Tunis rendering, for tool outputs. */
export function describeInstant(date: Date, now: Date = new Date()) {
  return {
    utc: date.toISOString(),
    tunis: formatTunisTime(date),
    daysLeft: daysLeft(date, now),
  };
}
