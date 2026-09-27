import { tndToMillimes } from "../lib/money.js";
import { tunisToUtc } from "../lib/time.js";

/**
 * Normalisation helpers for ingestion (plan §7): dates → UTC, TND → millimes,
 * text cleanup, sector tagging by FR/AR keyword rules (v1; LLM classification
 * with human review is Phase 5).
 */

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

/** Trim and collapse internal whitespace; empty input becomes undefined. */
export function normaliseText(value: string | null | undefined): string | undefined {
  if (value == null) return undefined;
  const cleaned = value.trim().replace(/\s+/g, " ");
  return cleaned === "" ? undefined : cleaned;
}

/** Lowercase and strip diacritics for keyword matching (Arabic unaffected). */
function foldAccents(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const DATE_PATTERNS: RegExp[] = [
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/, // ISO date, no zone
  /^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/, // DD/MM/YYYY
];

/**
 * Parse a tender date to a UTC instant.
 *
 * Inputs with an explicit zone/offset (ISO "Z" or "+01:00") are honoured as
 * given. Inputs **without** a zone are assumed to be Africa/Tunis wall clock —
 * fixed UTC+1 all year (Tunisia abolished DST in 2009, so there is no DST
 * ambiguity to resolve; summer and winter dates shift by exactly one hour).
 *
 * Throws on unparseable input — a wrong date is worse than a failed row.
 */
export function parseTenderDate(input: string): Date {
  const value = input.trim();

  // Explicit timezone: let Date handle it.
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(value)) {
    const zoned = new Date(value);
    if (Number.isNaN(zoned.getTime())) throw new Error(`Invalid date: "${input}"`);
    return zoned;
  }

  const iso = DATE_PATTERNS[0]!.exec(value);
  if (iso) {
    const [, y, mo, d, h, mi, s] = iso;
    return tunisToUtc(
      Number(y),
      Number(mo),
      Number(d),
      Number(h ?? 0),
      Number(mi ?? 0),
      Number(s ?? 0),
    );
  }

  const fr = DATE_PATTERNS[1]!.exec(value);
  if (fr) {
    const [, d, mo, y, h, mi, s] = fr;
    return tunisToUtc(
      Number(y),
      Number(mo),
      Number(d),
      Number(h ?? 0),
      Number(mi ?? 0),
      Number(s ?? 0),
    );
  }

  throw new Error(
    `Invalid date: "${input}". Use YYYY-MM-DD[ HH:mm] or DD/MM/YYYY[ HH:mm] (Africa/Tunis assumed), or full ISO with timezone.`,
  );
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

/** TND input ("12 500,500", "12500.5", 12500.5) → BigInt millimes. */
export function normaliseMillimes(value: string | number | null | undefined): bigint | undefined {
  if (value == null || value === "") return undefined;
  return tndToMillimes(value);
}

// ---------------------------------------------------------------------------
// Sector tagging (keyword rules, FR/AR synonyms)
// ---------------------------------------------------------------------------

interface SectorRule {
  tag: string;
  keywords: string[]; // pre-folded (lowercase, accents stripped)
}

const SECTOR_RULES: SectorRule[] = [
  {
    tag: "cctv",
    keywords: [
      "camera",
      "videosurveillance",
      "video-surveillance",
      "كاميرا",
      "كاميرات",
      "مراقبة بالكاميرات",
    ],
  },
  {
    tag: "network",
    keywords: ["reseau", "fibre", "wifi", "wi-fi", "cablage", "شبكة", "شبكات", "الياف"],
  },
  {
    tag: "it",
    keywords: [
      "informatique",
      "logiciel",
      "ordinateur",
      "systeme d'information",
      "معلوماتية",
      "برمجيات",
      "حاسوب",
    ],
  },
  {
    tag: "security",
    keywords: ["gardiennage", "securite", "surveillance humaine", "حراسة", "امن"],
  },
  { tag: "cleaning", keywords: ["nettoyage", "proprete", "hygiene", "نظافة"] },
  {
    tag: "construction",
    keywords: ["travaux", "construction", "batiment", "rehabilitation", "اشغال", "بناء", "تهيئة"],
  },
  {
    tag: "medical",
    keywords: ["medical", "medicaments", "hopital", "sanitaire", "طبي", "ادوية", "مستشفى"],
  },
  {
    tag: "vehicles",
    keywords: [
      "vehicule",
      "vehicules",
      "voiture",
      "camion",
      "transport",
      "سيارة",
      "سيارات",
      "شاحنة",
      "نقل",
    ],
  },
  {
    tag: "office",
    keywords: ["fournitures de bureau", "mobilier", "papeterie", "مستلزمات مكتبية", "اثاث"],
  },
  {
    tag: "catering",
    keywords: ["restauration", "catering", "alimentaire", "اطعام", "مواد غذائية"],
  },
  { tag: "printing", keywords: ["impression", "imprimerie", "طباعة"] },
  {
    tag: "energy",
    keywords: ["electricite", "energie", "solaire", "photovoltaique", "كهرباء", "طاقة", "شمسية"],
  },
];

/**
 * Tag a tender from its free text (title + summary, FR and AR) using the
 * keyword rule table. Returns tags in rule order, deduplicated.
 */
export function tagSectors(...texts: Array<string | undefined>): string[] {
  const haystack = foldAccents(texts.filter((t): t is string => !!t).join(" "));
  const tags: string[] = [];
  for (const rule of SECTOR_RULES) {
    if (rule.keywords.some((kw) => haystack.includes(foldAccents(kw)))) {
      tags.push(rule.tag);
    }
  }
  return tags;
}
