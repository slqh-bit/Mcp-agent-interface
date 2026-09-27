import { describe, expect, it } from "vitest";

import { hasScope, isScope, SCOPES, validateScopes } from "../../src/auth/scopes.js";
import {
  checkTokenState,
  generateToken,
  hashToken,
  isTokenFormat,
  TOKEN_PREFIX,
} from "../../src/auth/tokens.js";

describe("generateToken", () => {
  it("produces the aik_live_ format with 32 base64url random chars", () => {
    const { token } = generateToken();
    expect(token.startsWith(TOKEN_PREFIX)).toBe(true);
    expect(isTokenFormat(token)).toBe(true);
    expect(token).toMatch(/^aik_live_[A-Za-z0-9_-]{32}$/);
  });

  it("prefix is the first 17 chars (aik_live_ + 8), unique per token", () => {
    const a = generateToken();
    const b = generateToken();
    expect(a.prefix.length).toBe(17);
    expect(a.prefix).toBe(a.token.slice(0, 17));
    expect(a.token.startsWith(a.prefix)).toBe(true);
    expect(a.prefix).not.toBe(b.prefix);
    expect(a.token).not.toBe(b.token);
  });

  it("hash is the SHA-256 hex of the raw token", () => {
    const { token, hash } = generateToken();
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token)).toBe(hash);
    expect(hashToken("aik_live_other")).not.toBe(hash);
  });
});

describe("isTokenFormat", () => {
  it("rejects malformed tokens", () => {
    expect(isTokenFormat("")).toBe(false);
    expect(isTokenFormat("aik_live_short")).toBe(false);
    expect(isTokenFormat("aik_test_" + "a".repeat(32))).toBe(false);
    expect(isTokenFormat("aik_live_" + "a".repeat(31))).toBe(false);
    expect(isTokenFormat("aik_live_" + "a".repeat(33))).toBe(false);
    expect(isTokenFormat("aik_live_" + "a".repeat(31) + "!")).toBe(false);
  });
});

describe("checkTokenState", () => {
  const now = new Date("2026-09-27T12:00:00Z");

  it("accepts an active token", () => {
    expect(checkTokenState({ revokedAt: null, expiresAt: null }, now)).toEqual({ ok: true });
    expect(
      checkTokenState({ revokedAt: null, expiresAt: new Date("2026-09-27T12:00:01Z") }, now),
    ).toEqual({ ok: true });
  });

  it("rejects a revoked token", () => {
    expect(
      checkTokenState({ revokedAt: new Date("2026-09-01T00:00:00Z"), expiresAt: null }, now),
    ).toEqual({ ok: false, reason: "revoked" });
  });

  it("rejects an expired token, including at the exact expiry instant", () => {
    expect(
      checkTokenState({ revokedAt: null, expiresAt: new Date("2026-09-27T12:00:00Z") }, now),
    ).toEqual({ ok: false, reason: "expired" });
    expect(
      checkTokenState({ revokedAt: null, expiresAt: new Date("2026-09-26T23:59:59Z") }, now),
    ).toEqual({ ok: false, reason: "expired" });
  });

  it("revoked wins over expired", () => {
    expect(
      checkTokenState(
        {
          revokedAt: new Date("2026-09-01T00:00:00Z"),
          expiresAt: new Date("2026-09-01T00:00:00Z"),
        },
        now,
      ),
    ).toEqual({ ok: false, reason: "revoked" });
  });
});

describe("scopes", () => {
  it("knows the five plan scopes", () => {
    expect([...SCOPES]).toEqual([
      "tenders:read",
      "tracking:read",
      "tracking:write",
      "searches:write",
      "alerts:read",
    ]);
  });

  it("validates scopes and lists unknown ones", () => {
    expect(validateScopes(["tenders:read", "alerts:read"])).toEqual([
      "tenders:read",
      "alerts:read",
    ]);
    expect(() => validateScopes(["tenders:read", "admin:all"])).toThrow(/admin:all/);
  });

  it("checks scope membership", () => {
    expect(isScope("tracking:write")).toBe(true);
    expect(isScope("admin:all")).toBe(false);
    expect(hasScope(["tenders:read", "tracking:read"], "tenders:read")).toBe(true);
    expect(hasScope(["tenders:read"], "tracking:write")).toBe(false);
  });
});
