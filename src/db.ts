import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "./generated/prisma/client.js";

/**
 * Prisma Client over the pg driver adapter.
 *
 * The schema generator uses `engineType = "client"` + the `queryCompiler` and
 * `driverAdapters` preview features (Prisma 6.19.3): queries are compiled to
 * SQL by a wasm module and executed by @prisma/adapter-pg over the pure-JS
 * `pg` driver. No glibc query-engine binary is loaded, which is what makes
 * Prisma usable on Android/Termux (bionic libc) at all — see README.
 * The same code runs unchanged on Linux/VPS.
 */
export function createDb(connectionString: string): PrismaClient {
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

export type Db = PrismaClient;
