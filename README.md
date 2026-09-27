# agent-interface-kit

An MCP (Model Context Protocol) server that exposes TUNEPS Tunisian public-tender
intelligence to AI agents. An SME, integrator or consultant connects Claude (or any
MCP-capable agent) and can ask which public tenders matter, track them through a
pipeline, build offer checklists and get deadline alerts. The public tender
catalogue is global and read-only for agents; each tenant's workspace (tracking,
notes, checklists, saved searches, alerts) is isolated per tenant.

This repository is at **Phase 1, Cycle 2 — Auth + Manual Ingestion**. The full
development plan (phases, data model, tool catalogue) lives in
`mcp-agent_interface.md` alongside this repo.

## Quickstart

Requires Node.js >= 20 and npm.

```sh
npm install
npm run prisma:generate        # generates the client into src/generated/ (gitignored)
cp .env.example .env           # adjust DATABASE_URL if needed
# start Postgres + apply migrations — see the two sections below
npm run seed                   # demo tenant + demo token + ~30 fixture tenders
npm run dev                    # tsx watch: MCP endpoint at http://localhost:3000/mcp
```

Verify:

```sh
curl http://localhost:3000/healthz    # {"status":"ok"}
npm test                              # unit + integration tests (real Postgres)
npm run typecheck && npm run lint
```

## Database: Docker vs native Postgres

`docker-compose.yml` (Postgres 16, healthcheck, named volume) is provided for the
future VPS deployment. **The Termux/Android dev device has no Docker**, so local
development uses a native Postgres cluster inside the project directory:

```sh
initdb -D .pgdata -U postgres --auth=trust
mkdir -p .pgsocket logs
pg_ctl -D .pgdata -l logs/pg.log \
  -o "-p 5433 -k $PWD/.pgsocket -c listen_addresses=localhost" start
createdb -h localhost -p 5433 -U postgres agent_interface_kit
```

Note: Termux ships PostgreSQL **18**, while the production target is **16** (the
docker-compose image). The migration SQL only uses features common to both.

## Prisma on Android/Termux

Prisma has no `android-arm64` engine build; the CLI falls back to
`debian-openssl` (glibc) binaries, which cannot execute under Android's bionic
libc. On this device:

- `npx prisma validate` / `prisma generate` — **work** (wasm-based).
- `npx prisma migrate deploy` / `migrate diff` / `migrate dev` — **fail** with
  "Schema engine error" (the schema-engine binary cannot execute).

### Runtime: driver adapter + query compiler (Cycle 2 decision)

The generated client **does run queries on this device**. The generator is
configured as:

```prisma
generator client {
  provider        = "prisma-client"
  output          = "../src/generated/prisma"   // gitignored, run prisma:generate
  engineType      = "client"
  previewFeatures = ["queryCompiler", "driverAdapters"]
}
```

With `engineType = "client"`, Prisma 6.19.3 (exact-pinned) compiles queries to
SQL in a **wasm** module instead of the glibc query-engine binary, and
`@prisma/adapter-pg` (exact-pinned, over the pure-JS `pg` driver) executes them.
No native binary is ever loaded, so bionic libc is fine — and the same code runs
unchanged on Linux/VPS. Prisma schema stays the single DDL source of truth and
the typed client API (`prisma.tender.findMany`, transactions, …) is kept. Note
the explicit `engineType = "client"`: with this pinned version the preview flags
alone do not flip the engine.

`src/db.ts` (`createDb`) is the only place the client is constructed.

### Migrations are hand-written SQL

Because the schema engine cannot run here, migrations are **hand-written raw SQL**
under `prisma/migrations/` and applied with `psql`:

```sh
psql -h localhost -p 5433 -U postgres -d agent_interface_kit \
  -v ON_ERROR_STOP=1 -f prisma/migrations/20260927000000_init/migration.sql
psql -h localhost -p 5433 -U postgres -d agent_interface_kit \
  -v ON_ERROR_STOP=1 -f prisma/migrations/20260927120000_ingestion_run/migration.sql
```

- `20260927000000_init` — full schema from `prisma/schema.prisma` plus the §5.3
  search machinery: `unaccent` + `pg_trgm`, immutable `f_unaccent()`, the
  `fr_unaccent` configuration, the generated `Tender.searchVector` tsvector and
  GIN indexes.
- `20260927120000_ingestion_run` — `IngestionRun` table (plan §7: one row per
  adapter run with source, timings, counts, errors).

Both have been applied and verified against the real local cluster, on the dev
database and on a fresh scratch database.

On a normal Linux machine or the VPS, `npm run prisma:migrate`
(`prisma migrate deploy`) applies the same files through Prisma's migration table.

## Auth quickstart (Cycle 2)

Every request to `/mcp` requires `Authorization: Bearer aik_live_…`. Missing,
malformed, unknown, revoked or expired tokens get `401` with a JSON error
(`{ "error": { "code", "message" } }`). The tenant is resolved from the token,
never from request input.

```sh
npm run token:create -- --tenant demo --name "claude-desktop" \
  --scopes tenders:read,tracking:read,tracking:write,searches:write,alerts:read \
  [--expires-in-days 90] [--create-tenant "Display Name"]
npm run token:list [-- --tenant demo]      # prefixes, scopes, state — never hashes
npm run token:revoke -- --prefix aik_live_XXXXXXXX
```

- Format: `aik_live_` + 32 base64url chars (192 bits). The first 17 chars are
  stored in `ApiToken.prefix` for lookup; only the **SHA-256 hash** of the full
  token is stored. The raw token is printed exactly once by `token:create` and
  `seed`, and never logged (pino redacts the Authorization header).
- `ApiToken.lastUsedAt` is updated at most once per minute per token
  (throttled, so hot agents don't turn every request into a write).
- `npm run seed` creates the `demo` tenant and a demo token (all five scopes);
  the raw demo token is printed once, for local testing only.

**Session↔token binding:** the MCP transport is stateless
(`sessionIdGenerator: undefined`) — there is no server-side session, so the
"Mcp-Session-Id used with a different token" attack has nothing to bind to: the
header is ignored entirely, and every request is authenticated independently by
its bearer token. Covered by `tests/integration/auth.test.ts`.

## Manual ingestion (Cycle 2)

```sh
npm run import:tenders -- tenders.csv     # or tenders.json
```

CSV (header row; quoted fields per RFC 4180) or JSON (array of objects). Fields
(`* =` required):

| Field                                                                                                           | Notes                                                                                                             |
| --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `reference`\*                                                                                                   | dedupe key, e.g. `S2026-00101`                                                                                    |
| `title`\*, `deadlineAt`\*, `buyerName`\*                                                                        | deadline: `DD/MM/YYYY[ HH:mm]` or `YYYY-MM-DD[ HH:mm]`, Africa/Tunis assumed when no zone; ISO with zone honoured |
| `buyerType`                                                                                                     | `ministère` / `municipalité` / `entreprise publique` / `établissement` (FR/AR synonyms, or enum names)            |
| `procedureType`                                                                                                 | `open` / `restricted` / `consultation` / `négocié`                                                                |
| `category`                                                                                                      | `travaux` / `fournitures` / `services` / `études`                                                                 |
| `status`                                                                                                        | `open` / `closed` / `cancelled` / `awarded`                                                                       |
| `bidBondTnd`                                                                                                    | TND, stored as BigInt millimes (×1000)                                                                            |
| `sectors`                                                                                                       | comma list; auto-tagged from FR/AR keywords when absent                                                           |
| `lots`, `documents`                                                                                             | JSON arrays: `[{"number":1,"title":"…","bidBondTnd":"3000"}]`, `[{"kind":"avis","title":"…","url":"…"}]`          |
| `titleAr`, `summary`, `buyerNameAr`, `buyerRegion`, `region`, `publishedAt`, `openingAt`, `source`, `sourceUrl` | optional                                                                                                          |

Each run upserts Tender/Buyer/Lot/TenderDocument (dedupe by `reference`),
diffs the `contentHash` and writes TenderEvents (`CREATED` on first import,
`DEADLINE_CHANGED`, `AMENDED`, `CANCELLED`). Re-importing an unchanged file
creates **no** duplicate events. Per-row errors are collected and the
`IngestionRun` row finishes `SUCCESS` / `PARTIAL` / `FAILED`.

## What's in Cycle 2

- `src/auth/tokens.ts` — token generation (`aik_live_…`), SHA-256 hashing,
  resolution with revoked/expired checks, throttled `lastUsedAt`.
- `src/auth/scopes.ts` — the five plan §6 scopes.
- `src/auth/middleware.ts` — Express bearer auth on `/mcp` (401 JSON errors),
  attaches tenant+scopes to the request.
- `src/db.ts` — Prisma Client over `@prisma/adapter-pg` + wasm query compiler.
- `src/ingestion/` — `adapter.ts` (SourceAdapter contract, plan §7),
  `adapters/manual.ts` (CSV/JSON), `normalise.ts` (Tunis dates, millimes,
  FR/AR sector keyword rules), `upsert.ts`, `diff.ts` (contentHash → events),
  `run.ts` (IngestionRun bookkeeping).
- `scripts/` — `create-token.ts`, `revoke-token.ts`, `list-tokens.ts`,
  `import-tenders.ts`.
- `prisma/seed.ts` + `prisma/fixtures/tenders.json` — demo tenant, demo token,
  and 33 realistic but clearly synthetic Tunisian tenders (mixed FR/AR,
  ministries/municipalities/public companies, lots, documents, amendment
  events, past and future deadlines) standing in for Phase 0.4's real
  collection.
- Tests: unit (tokens, scopes, normalise incl. Tunis no-DST edge, diff, CSV
  parsing) and integration against the real local Postgres (auth on /mcp,
  stateless session-binding rule, full import flow with re-import and
  deadline-change cases, seed idempotency). Cycle 1's echo integration test
  now runs authenticated.

## What's in Cycle 1

- `src/index.ts` / `src/app.ts` — Express entry: MCP endpoint at `/mcp`, trivial `/healthz`.
- `src/mcp/` — the **only** folder importing `@modelcontextprotocol/sdk` (pinned
  at 1.30.1, plan decision D1). Stateless Streamable HTTP transport + a spike
  `echo` tool (zod input `{ message: string }`).
- `src/config.ts` — zod-validated env (`PORT`, `DATABASE_URL`, `LOG_LEVEL`,
  `NODE_ENV`), fails fast with a readable error.
- `src/lib/logger.ts` — pino logger, redaction paths preconfigured.
- `src/lib/env.ts` — built-in `.env` loading (Node ≥ 20.12, no dependency).
- `src/lib/time.ts` — Africa/Tunis helpers: Tunis formatting, UTC↔Tunis
  conversion, `daysLeft` computed on Tunis calendar days.
- `src/lib/money.ts` — BigInt millimes ↔ TND, French formatting (`12 500,000 DT`).
- `prisma/schema.prisma` — §5.1 public catalogue + §5.2 tenant workspace, all
  enums, `searchVector` as `Unsupported("tsvector")`.
- `prisma/migrations/20260927000000_init/migration.sql` — hand-written DDL + FTS.
- `tests/unit/` — time, money and config tests. `tests/integration/mcp-echo.test.ts`
  proves an SDK `Client` over `StreamableHTTPClientTransport` can connect, list
  tools and call `echo` (MCP Inspector can't run interactively on this device,
  so this test is the proof).

## Scripts

| Script                    | Purpose                                             |
| ------------------------- | --------------------------------------------------- |
| `npm run dev`             | tsx watch, dev server                               |
| `npm run build` / `start` | `tsc` build to `dist/`, run compiled entry          |
| `npm test` / `test:watch` | Vitest                                              |
| `npm run lint` / `format` | ESLint 9 (flat config) / Prettier                   |
| `npm run typecheck`       | `tsc --noEmit`                                      |
| `npm run seed`            | Demo tenant + demo token + fixture tenders          |
| `npm run token:create`    | Create an API token (raw token printed once)        |
| `npm run token:list`      | List tokens (prefixes/state only)                   |
| `npm run token:revoke`    | Revoke a token by prefix                            |
| `npm run import:tenders`  | Import a CSV/JSON tender file                       |
| `npm run prisma:migrate`  | `prisma migrate deploy` (Linux/VPS only, see above) |
| `npm run prisma:generate` | `prisma generate` (needed after clone/install)      |

## Roadmap

Per the plan (§8): Cycle 3 adds the catalogue tools (`search_tenders`,
`get_tender`, deadlines, buyers); Cycle 4 the workspace tools and first agent
end-to-end. Phase 2 adds automated sources, alerts and deployment on a Tunisian
VPS.
