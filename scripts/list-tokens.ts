/**
 * List API tokens (never hashes, never raw tokens).
 *
 * Usage: npm run token:list [-- --tenant <slug>]
 */
import { loadConfig } from "../src/config.js";
import { createDb } from "../src/db.js";
import { loadDotEnv } from "../src/lib/env.js";
import { parseArgs } from "./lib/cli.js";

async function main(): Promise<void> {
  const { flags } = parseArgs(process.argv.slice(2));
  const tenantSlug = typeof flags["tenant"] === "string" ? flags["tenant"] : undefined;

  loadDotEnv();
  const config = loadConfig();
  const db = createDb(config.DATABASE_URL);

  try {
    const tokens = await db.apiToken.findMany({
      where: tenantSlug ? { tenant: { slug: tenantSlug } } : undefined,
      include: { tenant: { select: { slug: true } } },
      orderBy: { createdAt: "asc" },
    });

    if (tokens.length === 0) {
      console.log("No tokens found.");
      return;
    }

    for (const t of tokens) {
      const state = t.revokedAt
        ? `revoked ${t.revokedAt.toISOString()}`
        : t.expiresAt && t.expiresAt.getTime() <= Date.now()
          ? "expired"
          : "active";
      console.log(
        [
          `${t.prefix}…`,
          `tenant=${t.tenant.slug}`,
          `name="${t.name}"`,
          `scopes=${t.scopes.join(",")}`,
          `state=${state}`,
          `expires=${t.expiresAt?.toISOString() ?? "never"}`,
          `lastUsed=${t.lastUsedAt?.toISOString() ?? "never"}`,
        ].join("  "),
      );
    }
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(`token:list failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
