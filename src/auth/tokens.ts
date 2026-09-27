import { createHash, randomBytes } from "node:crypto";

import type { Db } from "../db.js";
import type { Scope } from "./scopes.js";

/**
 * API tokens (plan §5.2 ApiToken).
 *
 * Format: `aik_live_<32 base64url chars>` (192 bits of entropy). The first 16
 * characters (`aik_live_` + 8 random chars, ~48 bits) are stored in
 * ApiToken.prefix as a lookup key; the database only ever stores the SHA-256
 * hash of the full token. The raw token is shown once at creation and never
 * logged (pino redaction covers the Authorization header).
 */

export const TOKEN_PREFIX = "aik_live_";
export const TOKEN_PATTERN = /^aik_live_[A-Za-z0-9_-]{32}$/;
const RANDOM_BYTES = 24; // 192 bits → 32 base64url chars
const PREFIX_LENGTH = TOKEN_PREFIX.length + 8;

/** Minimum interval between ApiToken.lastUsedAt writes for one token. */
export const LAST_USED_THROTTLE_MS = 60_000;

export interface GeneratedToken {
  /** The raw bearer token. Shown to the user exactly once. */
  token: string;
  prefix: string;
  hash: string;
}

export function generateToken(): GeneratedToken {
  const token = TOKEN_PREFIX + randomBytes(RANDOM_BYTES).toString("base64url");
  return { token, prefix: token.slice(0, PREFIX_LENGTH), hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function isTokenFormat(token: string): boolean {
  return TOKEN_PATTERN.test(token);
}

/** Tenant + scope context resolved from a valid token (plan principle 3:
 * the tenant always comes from the token, never from request input). */
export interface AuthContext {
  tokenId: string;
  prefix: string;
  tenantId: string;
  tenantSlug: string;
  tenantLocale: string;
  scopes: Scope[];
}

export type TokenRejection = "malformed" | "invalid" | "revoked" | "expired";

export type ResolveResult = { ok: true; auth: AuthContext } | { ok: false; reason: TokenRejection };

/**
 * Pure state check, unit-testable without a database. `record` is the
 * ApiToken row shape relevant to validity.
 */
export function checkTokenState(
  record: { revokedAt: Date | null; expiresAt: Date | null },
  now: Date = new Date(),
): { ok: true } | { ok: false; reason: "revoked" | "expired" } {
  if (record.revokedAt !== null) return { ok: false, reason: "revoked" };
  if (record.expiresAt !== null && record.expiresAt.getTime() <= now.getTime()) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true };
}

// Throttle map: tokenId → timestamp of the last lastUsedAt write. Per-process;
// worst case after a restart is one extra write per token, which is fine.
const lastUsedWrites = new Map<string, number>();

/**
 * Resolve a raw bearer token to its AuthContext. Looks up by prefix, compares
 * the SHA-256 hash, then applies revoked/expired checks. Updates lastUsedAt
 * at most once per LAST_USED_THROTTLE_MS per token so hot agents don't turn
 * every request into a write.
 */
export async function resolveToken(db: Db, raw: string): Promise<ResolveResult> {
  if (!isTokenFormat(raw)) return { ok: false, reason: "malformed" };

  const record = await db.apiToken.findUnique({
    where: { prefix: raw.slice(0, PREFIX_LENGTH) },
    include: { tenant: true },
  });
  if (!record || record.hash !== hashToken(raw)) return { ok: false, reason: "invalid" };

  const state = checkTokenState(record);
  if (!state.ok) return { ok: false, reason: state.reason };

  const now = Date.now();
  const lastWrite = lastUsedWrites.get(record.id) ?? 0;
  if (now - lastWrite >= LAST_USED_THROTTLE_MS) {
    lastUsedWrites.set(record.id, now);
    await db.apiToken.update({
      where: { id: record.id },
      data: { lastUsedAt: new Date(now) },
    });
  }

  return {
    ok: true,
    auth: {
      tokenId: record.id,
      prefix: record.prefix,
      tenantId: record.tenantId,
      tenantSlug: record.tenant.slug,
      tenantLocale: record.tenant.locale,
      scopes: record.scopes as Scope[],
    },
  };
}

/** Test hook: reset the lastUsedAt throttle map. */
export function resetLastUsedThrottle(): void {
  lastUsedWrites.clear();
}
