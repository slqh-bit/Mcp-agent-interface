/**
 * Money helpers for Tunisian dinars (plan §5.3).
 *
 * Amounts are stored as BigInt millimes (1 TND = 1000 millimes) because TND
 * has three decimals and floats are not safe. Display uses the French
 * format: "12 500,000 DT".
 */

export const MILLIMES_PER_TND = 1000n;

/** Narrow no-break space, the French thousands separator used by fr-TN. */
const THOUSANDS_SEP = " ";

/**
 * Parse a TND amount to millimes. Accepts "12500.5", "12500,500" and the
 * French grouped form "12 500,500" (regular or narrow spaces).
 * Throws on invalid input or more than three decimals.
 */
export function tndToMillimes(input: string | number | bigint): bigint {
  if (typeof input === "bigint") return input * MILLIMES_PER_TND;
  if (typeof input === "number") {
    if (!Number.isFinite(input)) throw new Error(`Invalid TND amount: ${input}`);
    // Route through string with 3-decimal rounding to avoid float artefacts.
    return tndToMillimes(input.toFixed(3));
  }

  const cleaned = input
    .trim()
    .replace(/\s*DT$/i, "")
    .replace(/[\s\u00A0\u202F]/g, "")
    .replace(",", ".");
  const match = /^(-?)(\d+)(?:\.(\d{1,3}))?$/.exec(cleaned);
  if (!match) throw new Error(`Invalid TND amount: "${input}"`);

  const [, sign = "", dinars = "", decimals = ""] = match;
  const millimes = BigInt(dinars) * MILLIMES_PER_TND + BigInt(decimals.padEnd(3, "0") || "0");
  return sign === "-" ? -millimes : millimes;
}

/** Exact decimal TND value as a string, e.g. 12_500_500n → "12500.500". */
export function millimesToTndString(millimes: bigint): string {
  const negative = millimes < 0n;
  const abs = negative ? -millimes : millimes;
  const dinars = abs / MILLIMES_PER_TND;
  const rem = (abs % MILLIMES_PER_TND).toString().padStart(3, "0");
  return `${negative ? "-" : ""}${dinars.toString()}.${rem}`;
}

/**
 * French display format: "12 500,000 DT" (always three decimals, narrow
 * no-break spaces as thousands separators). Pure bigint arithmetic — no
 * float involved.
 */
export function formatTnd(millimes: bigint): string {
  const negative = millimes < 0n;
  const abs = negative ? -millimes : millimes;
  const dinars = abs / MILLIMES_PER_TND;
  const rem = (abs % MILLIMES_PER_TND).toString().padStart(3, "0");

  const digits = dinars.toString();
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, THOUSANDS_SEP);
  return `${negative ? "-" : ""}${grouped},${rem} DT`;
}
