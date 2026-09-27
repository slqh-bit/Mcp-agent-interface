import { readFile } from "node:fs/promises";

import {
  BuyerType,
  ProcedureType,
  TenderCategory,
  TenderStatus,
} from "../../generated/prisma/enums.js";
import type { NormalisedDocument, NormalisedLot, RawTender, SourceAdapter } from "../adapter.js";
import { normaliseMillimes, normaliseText, parseTenderDate, tagSectors } from "../normalise.js";

/**
 * Manual adapter (plan §7): imports tenders from a local CSV or JSON file.
 * Always available — it guarantees the product works even if every automated
 * source is blocked.
 *
 * Columns / JSON fields (snake or camel case accepted):
 *   reference*, title*, deadlineAt*, buyerName*, buyerType* ,
 *   titleAr, summary, buyerNameAr, buyerRegion, procedureType, category,
 *   sectors (comma list; auto-tagged from text when absent), region,
 *   publishedAt, openingAt, bidBondTnd, status, sourceUrl,
 *   lots (JSON: [{number,title,bidBondTnd?}]),
 *   documents (JSON: [{kind,title,url?}])
 *
 * Dates without a timezone are read as Africa/Tunis wall clock; money is TND.
 */

// ---------------------------------------------------------------------------
// CSV parsing (RFC 4180: quotes, escaped quotes, commas and newlines in fields)
// ---------------------------------------------------------------------------

export function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  if (content.charCodeAt(0) === 0xfeff) i = 1; // strip BOM

  while (i < content.length) {
    const ch = content[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (content[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (ch === "\r") {
      i++;
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** CSV text → row objects keyed by header name. */
export function csvToRecords(content: string): RawTender[] {
  const rows = parseCsv(content);
  if (rows.length === 0) return [];
  const header = rows[0]!.map((h) => h.trim());
  const records: RawTender[] = [];
  for (const cells of rows.slice(1)) {
    if (cells.every((c) => c.trim() === "")) continue; // skip blank lines
    const record: RawTender = {};
    header.forEach((name, index) => {
      record[name] = cells[index] ?? "";
    });
    records.push(record);
  }
  return records;
}

// ---------------------------------------------------------------------------
// Field mapping
// ---------------------------------------------------------------------------

function str(row: RawTender, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim() !== "") return value;
    if (typeof value === "number") return String(value);
  }
  return undefined;
}

function requireStr(row: RawTender, ...keys: string[]): string {
  const value = str(row, ...keys);
  if (value === undefined) throw new Error(`Missing required field: ${keys.join("/")}`);
  return value;
}

function pickEnum<T extends string>(
  value: string | undefined,
  synonyms: Record<string, T>,
  fallback: T,
  field: string,
): T {
  if (value === undefined) return fallback;
  const key = value.trim().toLowerCase();
  const mapped = synonyms[key];
  if (!mapped) {
    throw new Error(
      `Invalid ${field}: "${value}". Valid: ${[...new Set(Object.values(synonyms))].join(", ")}`,
    );
  }
  return mapped;
}

const BUYER_TYPES: Record<string, BuyerType> = {
  ministry: BuyerType.MINISTRY,
  ministere: BuyerType.MINISTRY,
  ministère: BuyerType.MINISTRY,
  وزارة: BuyerType.MINISTRY,
  municipality: BuyerType.MUNICIPALITY,
  municipalite: BuyerType.MUNICIPALITY,
  municipalité: BuyerType.MUNICIPALITY,
  commune: BuyerType.MUNICIPALITY,
  بلدية: BuyerType.MUNICIPALITY,
  public_company: BuyerType.PUBLIC_COMPANY,
  "entreprise publique": BuyerType.PUBLIC_COMPANY,
  "شركة عمومية": BuyerType.PUBLIC_COMPANY,
  establishment: BuyerType.ESTABLISHMENT,
  etablissement: BuyerType.ESTABLISHMENT,
  établissement: BuyerType.ESTABLISHMENT,
  مؤسسة: BuyerType.ESTABLISHMENT,
  other: BuyerType.OTHER,
};

const PROCEDURE_TYPES: Record<string, ProcedureType> = {
  open: ProcedureType.OPEN,
  "appel d'offres ouvert": ProcedureType.OPEN,
  "ao ouvert": ProcedureType.OPEN,
  restricted: ProcedureType.RESTRICTED,
  "appel d'offres restreint": ProcedureType.RESTRICTED,
  consultation: ProcedureType.CONSULTATION,
  "consultation restreinte": ProcedureType.CONSULTATION,
  استشارة: ProcedureType.CONSULTATION,
  negotiated: ProcedureType.NEGOTIATED,
  negocie: ProcedureType.NEGOTIATED,
  négocié: ProcedureType.NEGOTIATED,
  "marché négocié": ProcedureType.NEGOTIATED,
  other: ProcedureType.OTHER,
};

const CATEGORIES: Record<string, TenderCategory> = {
  works: TenderCategory.WORKS,
  travaux: TenderCategory.WORKS,
  اشغال: TenderCategory.WORKS,
  supplies: TenderCategory.SUPPLIES,
  fournitures: TenderCategory.SUPPLIES,
  توريد: TenderCategory.SUPPLIES,
  services: TenderCategory.SERVICES,
  خدمات: TenderCategory.SERVICES,
  studies: TenderCategory.STUDIES,
  etudes: TenderCategory.STUDIES,
  études: TenderCategory.STUDIES,
  دراسة: TenderCategory.STUDIES,
};

const STATUSES: Record<string, TenderStatus> = {
  open: TenderStatus.OPEN,
  ouvert: TenderStatus.OPEN,
  closed: TenderStatus.CLOSED,
  cloture: TenderStatus.CLOSED,
  clôturé: TenderStatus.CLOSED,
  cancelled: TenderStatus.CANCELLED,
  annule: TenderStatus.CANCELLED,
  annulé: TenderStatus.CANCELLED,
  awarded: TenderStatus.AWARDED,
  attribue: TenderStatus.AWARDED,
  attribué: TenderStatus.AWARDED,
  unknown: TenderStatus.UNKNOWN,
};

function parseJsonField<T>(raw: string | undefined, field: string): T[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("not an array");
    return parsed as T[];
  } catch {
    throw new Error(`Invalid ${field}: expected a JSON array, got "${raw.slice(0, 80)}"`);
  }
}

interface LotInput {
  number: number;
  title: string;
  bidBondTnd?: string | number;
}

interface DocumentInput {
  kind: string;
  title: string;
  url?: string;
}

/** Map one raw row (CSV record or JSON object) to a NormalisedTender. */
export function parseManualRow(row: RawTender): ReturnType<SourceAdapter["parse"]> {
  const title = normaliseText(requireStr(row, "title"))!;
  const titleAr = normaliseText(str(row, "titleAr", "title_ar"));
  const summary = normaliseText(str(row, "summary"));

  const explicitSectors = str(row, "sectors")
    ?.split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s !== "");
  const sectors =
    explicitSectors && explicitSectors.length > 0
      ? [...new Set(explicitSectors)]
      : tagSectors(title, titleAr, summary);

  const lots: NormalisedLot[] = parseJsonField<LotInput>(
    typeof row["lots"] === "string" ? row["lots"] : undefined,
    "lots",
  ).map((lot) => ({
    number: Number(lot.number),
    title: normaliseText(String(lot.title)) ?? "",
    bidBondMillimes: normaliseMillimes(lot.bidBondTnd ?? null),
  }));

  // JSON files may carry lots/documents as real arrays rather than strings.
  if (Array.isArray(row["lots"])) {
    lots.length = 0;
    for (const lot of row["lots"] as LotInput[]) {
      lots.push({
        number: Number(lot.number),
        title: normaliseText(String(lot.title)) ?? "",
        bidBondMillimes: normaliseMillimes(lot.bidBondTnd ?? null),
      });
    }
  }

  let documents: NormalisedDocument[] = [];
  const rawDocs = Array.isArray(row["documents"])
    ? (row["documents"] as DocumentInput[])
    : parseJsonField<DocumentInput>(
        typeof row["documents"] === "string" ? row["documents"] : undefined,
        "documents",
      );
  documents = rawDocs.map((doc) => ({
    kind: normaliseText(String(doc.kind)) ?? "avis",
    title: normaliseText(String(doc.title)) ?? "",
    url: normaliseText(doc.url),
  }));

  return {
    reference: normaliseText(requireStr(row, "reference"))!,
    source: normaliseText(str(row, "source")) ?? "manual",
    sourceUrl: normaliseText(str(row, "sourceUrl", "source_url")),
    buyer: {
      name: normaliseText(requireStr(row, "buyerName", "buyer_name", "buyer"))!,
      nameAr: normaliseText(str(row, "buyerNameAr", "buyer_name_ar")),
      type: pickEnum(
        str(row, "buyerType", "buyer_type"),
        BUYER_TYPES,
        BuyerType.OTHER,
        "buyerType",
      ),
      region: normaliseText(str(row, "buyerRegion", "buyer_region")),
    },
    title,
    titleAr,
    summary,
    procedureType: pickEnum(
      str(row, "procedureType", "procedure_type"),
      PROCEDURE_TYPES,
      ProcedureType.OPEN,
      "procedureType",
    ),
    category: pickEnum(str(row, "category"), CATEGORIES, TenderCategory.SUPPLIES, "category"),
    sectors,
    region: normaliseText(str(row, "region")),
    publishedAt:
      str(row, "publishedAt", "published_at") != null
        ? parseTenderDate(str(row, "publishedAt", "published_at")!)
        : undefined,
    deadlineAt: parseTenderDate(requireStr(row, "deadlineAt", "deadline_at", "deadline")),
    openingAt:
      str(row, "openingAt", "opening_at") != null
        ? parseTenderDate(str(row, "openingAt", "opening_at")!)
        : undefined,
    bidBondMillimes: normaliseMillimes(str(row, "bidBondTnd", "bid_bond_tnd") ?? null),
    status: pickEnum(str(row, "status"), STATUSES, TenderStatus.OPEN, "status"),
    lots,
    documents,
  };
}

/** Adapter factory: `createManualAdapter("tenders.csv")` or a `.json` file. */
export function createManualAdapter(filePath: string): SourceAdapter {
  return {
    id: "manual",
    enabled: true,
    async *fetchChanged(): AsyncIterable<RawTender> {
      const content = await readFile(filePath, "utf8");
      if (filePath.endsWith(".json")) {
        const parsed: unknown = JSON.parse(content);
        if (!Array.isArray(parsed)) {
          throw new Error(`JSON import file must contain an array of tender objects: ${filePath}`);
        }
        for (const item of parsed as RawTender[]) yield item;
      } else {
        for (const record of csvToRecords(content)) yield record;
      }
    },
    parse: parseManualRow,
  };
}
