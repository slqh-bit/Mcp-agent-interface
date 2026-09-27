/**
 * Revoke an API token by its lookup prefix (shown by `token:list`).
 *
 * Usage: npm run token:revoke -- --prefix aik_live_XXXXXXXX
 */
import { loadConfig } from "../src/config.js";
import { createDb } from "../src/db.js";
import { loadDotEnv } from "../src/lib/env.js";
import { parseArgs, requireFlag } from "./lib/cli.js";

async function main(): Promise<void> {
  const { flags } = parseArgs(process.argv.slice(2));
  const prefix = requireFlag(flags, "prefix");

  loadDotEnv();
  const config = loadConfig();
  const db = createDb(config.DATABASE_URL);

  try {
    const token = await db.apiToken.findUnique({
      where: { prefix },
      include: { tenant: { select: { slug: true } } },
    });
    if (!token) throw new Error(`No token with prefix "${prefix}".`);

    if (token.revokedAt) {
      console.log(
        `Token ${prefix}… (${token.name}, tenant ${token.tenant.slug}) was already revoked.`,
      );
      return;
    }

    await db.apiToken.update({ where: { id: token.id }, data: { revokedAt: new Date() } });
    console.log(`Revoked token ${prefix}… (${token.name}, tenant ${token.tenant.slug}).`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(`token:revoke failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
