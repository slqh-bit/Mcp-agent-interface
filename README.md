# agent-interface-kit

An MCP (Model Context Protocol) server that exposes TUNEPS Tunisian public-tender
intelligence to AI agents. An SME, integrator or consultant connects Claude (or any
MCP-capable agent) and can ask which public tenders matter, track them through a
pipeline, build offer checklists and get deadline alerts. The public tender
catalogue is global and read-only for agents; each tenant's workspace (tracking,
notes, checklists, saved searches, alerts) is isolated per tenant.

This repository is at **Phase 1, Cycle 1 — Foundation**. The full development plan
(phases, data model, tool catalogue) lives in `mcp-agent_interface.md` alongside
this repo.

## Quickstart

Requires Node.js >= 20 and npm.

```sh
npm install
cp .env.example .env        # adjust DATABASE_URL if needed
npm run dev                 # tsx watch: MCP endpoint at http://localhost:3000/mcp
```

Verify:

```sh
curl http://localhost:3000/healthz    # {"status":"ok"}
npm test                              # unit + MCP integration tests
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

## Prisma on Android/Termux — what works and what doesn't

Prisma has no `android-arm64` engine build; the CLI falls back to
`debian-openssl` (glibc) binaries, which cannot execute under Android's bionic
libc. On this device:

- `npx prisma validate` — **works** (wasm-based).
- `npx prisma generate` — **works** (client generation is wasm-based). The
  generated client cannot run queries here because the query engine is a glibc
  binary; it will work on the VPS.
- `npx prisma migrate deploy` / `migrate diff` / `migrate dev` — **fail** with
  "Schema engine error" (the schema-engine binary cannot execute).

Because of this, migrations are **hand-written raw SQL** under
`prisma/migrations/` and applied with `psql`:

```sh
psql -h localhost -p 5433 -U postgres -d agent_interface_kit \
  -v ON_ERROR_STOP=1 -f prisma/migrations/20260927000000_init/migration.sql
```

The initial migration creates the full schema from `prisma/schema.prisma` plus the
search machinery (plan §5.3): the `unaccent` and `pg_trgm` extensions, an
immutable `f_unaccent()` wrapper, the `fr_unaccent` text-search configuration, the
generated `Tender.searchVector` tsvector column, and GIN indexes for FTS and
trigram similarity. It has been applied and verified against a real local
PostgreSQL cluster (accent-insensitive FTS and trigram typo matching tested).

On a normal Linux machine or the VPS, `npm run prisma:migrate`
(`prisma migrate deploy`) applies the same files through Prisma's migration table.

## What's in Cycle 1

- `src/index.ts` / `src/app.ts` — Express entry: MCP endpoint at `/mcp`, trivial `/healthz`.
- `src/mcp/` — the **only** folder importing `@modelcontextprotocol/sdk` (pinned
  at 1.30.1, plan decision D1). Stateless Streamable HTTP transport + a spike
  `echo` tool (zod input `{ message: string }`).
- `src/config.ts` — zod-validated env (`PORT`, `DATABASE_URL`, `LOG_LEVEL`,
  `NODE_ENV`), fails fast with a readable error.
- `src/lib/logger.ts` — pino logger, redaction paths preconfigured.
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
| `npm run prisma:migrate`  | `prisma migrate deploy` (Linux/VPS only, see above) |
| `npm run prisma:generate` | `prisma generate`                                   |

## Roadmap

Per the plan (§8): Cycle 2 adds auth tokens and manual CSV/JSON ingestion;
Cycle 3 the catalogue tools (`search_tenders`, `get_tender`, deadlines, buyers);
Cycle 4 the workspace tools and first agent end-to-end. Phase 2 adds automated
sources, alerts and deployment on a Tunisian VPS.
