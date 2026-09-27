import type {
  BuyerType,
  ProcedureType,
  TenderCategory,
  TenderStatus,
} from "../generated/prisma/enums.js";

/**
 * SourceAdapter contract (plan §7). One adapter per source; the manual
 * CSV/JSON adapter is always available so the product works even if every
 * automated source is blocked.
 */

/** A raw, source-specific record as fetched. Shape is up to the adapter. */
export type RawTender = Record<string, unknown>;

export interface NormalisedLot {
  number: number;
  title: string;
  bidBondMillimes?: bigint;
}

export interface NormalisedDocument {
  kind: string; // "avis" | "cahier_des_charges" | "rectificatif" | …
  title: string;
  url?: string;
}

export interface NormalisedTender {
  reference: string;
  source: string;
  sourceUrl?: string;
  buyer: {
    name: string;
    nameAr?: string;
    type: BuyerType;
    region?: string;
  };
  title: string;
  titleAr?: string;
  summary?: string;
  procedureType: ProcedureType;
  category: TenderCategory;
  sectors: string[]; // normalised tags from the keyword rules
  region?: string;
  publishedAt?: Date;
  deadlineAt: Date; // UTC
  openingAt?: Date;
  bidBondMillimes?: bigint;
  status: TenderStatus;
  lots: NormalisedLot[];
  documents: NormalisedDocument[];
}

export interface SourceAdapter {
  id: string; // "manual", "ministry:mtc", "tuneps"
  enabled: boolean; // feature flag, env-driven
  fetchChanged(since: Date): AsyncIterable<RawTender>;
  parse(raw: RawTender): NormalisedTender;
}
