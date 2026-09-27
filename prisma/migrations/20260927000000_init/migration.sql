-- Cycle 1 initial migration — hand-written raw SQL (Prisma engines do not run
-- on Android/Termux; see README). Mirrors prisma/schema.prisma exactly and adds
-- the full-text-search machinery from plan §5.3:
--   * unaccent + pg_trgm extensions
--   * fr_unaccent text-search configuration (french stemmer behind unaccent)
--   * Tender.searchVector generated tsvector column
--   * GIN indexes for FTS and trigram similarity

CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

CREATE TYPE "BuyerType" AS ENUM ('MINISTRY', 'MUNICIPALITY', 'PUBLIC_COMPANY', 'ESTABLISHMENT', 'OTHER');
CREATE TYPE "ProcedureType" AS ENUM ('OPEN', 'RESTRICTED', 'CONSULTATION', 'NEGOTIATED', 'OTHER');
CREATE TYPE "TenderCategory" AS ENUM ('WORKS', 'SUPPLIES', 'SERVICES', 'STUDIES');
CREATE TYPE "TenderStatus" AS ENUM ('OPEN', 'CLOSED', 'CANCELLED', 'AWARDED', 'UNKNOWN');
CREATE TYPE "TenderEventType" AS ENUM ('CREATED', 'DEADLINE_CHANGED', 'AMENDED', 'CANCELLED', 'AWARDED', 'STATUS_CHANGED');
CREATE TYPE "PipelineStage" AS ENUM ('WATCHING', 'QUALIFYING', 'PREPARING', 'SUBMITTED', 'WON', 'LOST', 'DROPPED');
CREATE TYPE "Priority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');
CREATE TYPE "ChecklistCategory" AS ENUM ('admin', 'technical', 'financial');
CREATE TYPE "AlertKind" AS ENUM ('NEW_MATCH', 'DEADLINE_SOON', 'TENDER_AMENDED', 'TENDER_CANCELLED');
CREATE TYPE "AuditOutcome" AS ENUM ('SUCCESS', 'ERROR', 'DENIED');

-- ---------------------------------------------------------------------------
-- §5.1 Public catalogue
-- ---------------------------------------------------------------------------

CREATE TABLE "Buyer" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "nameAr" TEXT,
    "type" "BuyerType" NOT NULL,
    "region" TEXT,

    CONSTRAINT "Buyer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Tender" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "reference" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "buyerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "titleAr" TEXT,
    "summary" TEXT,
    "procedureType" "ProcedureType" NOT NULL,
    "category" "TenderCategory" NOT NULL,
    "cpvOrSector" TEXT[] NOT NULL,
    "region" TEXT,
    "publishedAt" TIMESTAMP(3),
    "deadlineAt" TIMESTAMP(3) NOT NULL,
    "openingAt" TIMESTAMP(3),
    "bidBondMillimes" BIGINT,
    "status" "TenderStatus" NOT NULL DEFAULT 'OPEN',
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "contentHash" TEXT NOT NULL,

    CONSTRAINT "Tender_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Lot" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "tenderId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "bidBondMillimes" BIGINT,

    CONSTRAINT "Lot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TenderDocument" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "tenderId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT,

    CONSTRAINT "TenderDocument_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TenderEvent" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "tenderId" TEXT NOT NULL,
    "type" "TenderEventType" NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenderEvent_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------------------------
-- §5.2 Tenant workspace
-- ---------------------------------------------------------------------------

CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'fr',
    "timezone" TEXT NOT NULL DEFAULT 'Africa/Tunis',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ApiToken" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "scopes" TEXT[] NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiToken_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TrackedTender" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" TEXT NOT NULL,
    "tenderId" TEXT NOT NULL,
    "stage" "PipelineStage" NOT NULL DEFAULT 'WATCHING',
    "owner" TEXT,
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "internalDeadline" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "TrackedTender_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TrackingNote" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "trackedId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrackingNote_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ChecklistItem" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "trackedId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "labelAr" TEXT,
    "category" "ChecklistCategory" NOT NULL,
    "required" BOOLEAN NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "dueAt" TIMESTAMP(3),
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "ChecklistItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SavedSearch" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "query" JSONB NOT NULL,
    "notify" BOOLEAN NOT NULL DEFAULT true,
    "channel" TEXT NOT NULL DEFAULT 'email',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "SavedSearch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Alert" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" TEXT NOT NULL,
    "kind" "AlertKind" NOT NULL,
    "tenderId" TEXT NOT NULL,
    "searchId" TEXT,
    "sentAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "input" JSONB,
    "outcome" "AuditOutcome" NOT NULL,
    "resourceIds" TEXT[] NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "clientName" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------------------------
-- Unique constraints and indexes
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX "Buyer_name_key" ON "Buyer"("name");
CREATE UNIQUE INDEX "Tender_reference_key" ON "Tender"("reference");
CREATE INDEX "Tender_deadlineAt_idx" ON "Tender"("deadlineAt");
CREATE INDEX "Tender_status_deadlineAt_idx" ON "Tender"("status", "deadlineAt");
CREATE UNIQUE INDEX "Lot_tenderId_number_key" ON "Lot"("tenderId", "number");
CREATE INDEX "TenderEvent_tenderId_at_idx" ON "TenderEvent"("tenderId", "at");
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");
CREATE UNIQUE INDEX "ApiToken_prefix_key" ON "ApiToken"("prefix");
CREATE UNIQUE INDEX "ApiToken_hash_key" ON "ApiToken"("hash");
CREATE INDEX "ApiToken_tenantId_idx" ON "ApiToken"("tenantId");
CREATE UNIQUE INDEX "TrackedTender_tenantId_tenderId_key" ON "TrackedTender"("tenantId", "tenderId");
CREATE INDEX "TrackedTender_tenantId_stage_idx" ON "TrackedTender"("tenantId", "stage");
CREATE INDEX "TrackedTender_tenderId_idx" ON "TrackedTender"("tenderId");
CREATE INDEX "TrackingNote_trackedId_idx" ON "TrackingNote"("trackedId");
CREATE INDEX "ChecklistItem_trackedId_idx" ON "ChecklistItem"("trackedId");
CREATE INDEX "SavedSearch_tenantId_idx" ON "SavedSearch"("tenantId");
CREATE UNIQUE INDEX "Alert_tenantId_kind_tenderId_searchId_key" ON "Alert"("tenantId", "kind", "tenderId", "searchId");
CREATE INDEX "Alert_tenantId_createdAt_idx" ON "Alert"("tenantId", "createdAt");
CREATE INDEX "AuditLog_tenantId_createdAt_idx" ON "AuditLog"("tenantId", "createdAt");

-- ---------------------------------------------------------------------------
-- Foreign keys
-- ---------------------------------------------------------------------------

ALTER TABLE "Tender" ADD CONSTRAINT "Tender_buyerId_fkey"
    FOREIGN KEY ("buyerId") REFERENCES "Buyer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Lot" ADD CONSTRAINT "Lot_tenderId_fkey"
    FOREIGN KEY ("tenderId") REFERENCES "Tender"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TenderDocument" ADD CONSTRAINT "TenderDocument_tenderId_fkey"
    FOREIGN KEY ("tenderId") REFERENCES "Tender"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TenderEvent" ADD CONSTRAINT "TenderEvent_tenderId_fkey"
    FOREIGN KEY ("tenderId") REFERENCES "Tender"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApiToken" ADD CONSTRAINT "ApiToken_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrackedTender" ADD CONSTRAINT "TrackedTender_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrackingNote" ADD CONSTRAINT "TrackingNote_trackedId_fkey"
    FOREIGN KEY ("trackedId") REFERENCES "TrackedTender"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChecklistItem" ADD CONSTRAINT "ChecklistItem_trackedId_fkey"
    FOREIGN KEY ("trackedId") REFERENCES "TrackedTender"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SavedSearch" ADD CONSTRAINT "SavedSearch_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- §5.3 Full-text search: french + unaccent + pg_trgm
-- ---------------------------------------------------------------------------

-- Immutable wrapper around unaccent() so it can be used in a generated column
-- (the stock unaccent() function is only STABLE, which PostgreSQL rejects in
-- generation expressions).
CREATE OR REPLACE FUNCTION f_unaccent(text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
AS $$ SELECT unaccent('unaccent', $1) $$;

-- Query-side configuration: "vidéosurveillance" and "videosurveillance" parse
-- to the same lexemes. Use as to_tsvector('fr_unaccent', ...) / plainto_tsquery.
CREATE TEXT SEARCH CONFIGURATION fr_unaccent (COPY = french);
ALTER TEXT SEARCH CONFIGURATION fr_unaccent
    ALTER MAPPING FOR hword, hword_part, word WITH unaccent, french_stem;

-- Generated tsvector column (Unsupported("tsvector") in schema.prisma).
-- French stemmer over unaccented title/summary; reference kept verbatim.
ALTER TABLE "Tender" ADD COLUMN "searchVector" tsvector
GENERATED ALWAYS AS (
    setweight(to_tsvector('french', f_unaccent(coalesce("title", ''))), 'A') ||
    setweight(to_tsvector('french', f_unaccent(coalesce("summary", ''))), 'B') ||
    setweight(to_tsvector('simple', coalesce("reference", '')), 'A')
) STORED;

CREATE INDEX "Tender_searchVector_idx" ON "Tender" USING GIN ("searchVector");
CREATE INDEX "Tender_title_trgm_idx" ON "Tender" USING GIN ("title" gin_trgm_ops);
