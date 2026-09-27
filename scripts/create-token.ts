/**
 * Create an API token for a tenant. Prints the raw token exactly ONCE — only
 * the SHA-256 hash is stored, so it can never be shown again.
 *
 * Usage:
 *   npm run token:create -- --tenant <slug> --name <label> [--scopes a,b,c]
 *                          [--expires-in-days N] [--create-tenant "Name"]
 */
import { SCOPES, validateScopes } from "../src/auth/scopes.js";
import { generateToken } from "../src/auth/tokens.js";
import { loadConfig } from "../src/config.js";
import { createDb } from "../src/db.js";
import { loadDotEnv } from "../src/lib/env.js";
import { parseArgs, requireFlag } from "./lib/cli.js";

async function main(): Promise<void> {
  const { flags } = parseArgs(process.argv.slice(2));
  const tenantSlug = requireFlag(flags, "tenant");
  const name = requireFlag(flags, "name");
  const scopes = validateScopes(
    typeof flags["scopes"] === "string"
      ? flags["scopes"].split(",").map((s) => s.trim())
      : [...SCOPES],
  );
  const expiresInDays =
    typeof flags["expires-in-days"] === "string"
      ? Number.parseInt(flags["expires-in-days"], 10)
      : undefined;
  if (expiresInDays !== undefined && (!Number.isInteger(expiresInDays) || expiresInDays < 1)) {
    throw new Error("--expires-in-days must be a positive integer");
  }

  loadDotEnv();
  const config = loadConfig();
  const db = createDb(config.DATABASE_URL);

  try {
    let tenant = await db.tenant.findUnique({ where: { slug: tenantSlug } });
    if (!tenant) {
      const createName = flags["create-tenant"];
      if (typeof createName !== "string" || createName === "") {
        throw new Error(
          `Tenant "${tenantSlug}" not found. Pass --create-tenant "Display Name" to create it, or run npm run seed.`,
        );
      }
      tenant = await db.tenant.create({ data: { name: createName, slug: tenantSlug } });
      console.log(`Created tenant "${tenant.name}" (${tenant.slug})`);
    }

    const generated = generateToken();
    const record = await db.apiToken.create({
      data: {
        tenantId: tenant.id,
        name,
        prefix: generated.prefix,
        hash: generated.hash,
        scopes,
        expiresAt:
          expiresInDays !== undefined ? new Date(Date.now() + expiresInDays * 86_400_000) : null,
      },
    });

    console.log("");
    console.log("Token created. Store the raw token now — it is shown only once:");
    console.log("");
    console.log(`  ${generated.token}`);
    console.log("");
    console.log(`  id:       ${record.id}`);
    console.log(`  tenant:   ${tenant.slug}`);
    console.log(`  name:     ${record.name}`);
    console.log(`  prefix:   ${record.prefix}`);
    console.log(`  scopes:   ${record.scopes.join(", ")}`);
    console.log(`  expires:  ${record.expiresAt?.toISOString() ?? "never"}`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(`token:create failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
