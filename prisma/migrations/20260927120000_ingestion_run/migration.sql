-- Cycle 2 migration — hand-written raw SQL (Prisma engines do not run on
-- Android/Termux; see README). Mirrors the IngestionRun model added to
-- prisma/schema.prisma (plan §7: each adapter run records source, timings,
-- counts and errors).

CREATE TYPE "IngestionRunStatus" AS ENUM ('SUCCESS', 'PARTIAL', 'FAILED');

CREATE TABLE "IngestionRun" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "source" TEXT NOT NULL,
    "status" "IngestionRunStatus" NOT NULL DEFAULT 'SUCCESS',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "fetched" INTEGER NOT NULL DEFAULT 0,
    "upserted" INTEGER NOT NULL DEFAULT 0,
    "events" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "IngestionRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "IngestionRun_source_startedAt_idx" ON "IngestionRun"("source", "startedAt");
