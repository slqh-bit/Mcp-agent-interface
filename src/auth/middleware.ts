import type { NextFunction, Request, RequestHandler, Response } from "express";

import type { Db } from "../db.js";
import { resolveToken, type AuthContext, type TokenRejection } from "./tokens.js";

/**
 * Bearer-token authentication for the MCP endpoint (plan §5.2, §10).
 *
 * Every request to /mcp must carry `Authorization: Bearer aik_live_…`.
 * The tenant is resolved from the token and attached to the request — it is
 * never taken from request input (plan principle 3).
 *
 * Session↔token binding: the transport runs stateless (Cycle 1 decision —
 * `sessionIdGenerator: undefined`), so the server holds no session that could
 * be replayed under a different token. The stateless transport ignores the
 * Mcp-Session-Id header entirely — a forged id grants nothing, and a request
 * carrying one still gets 401 without a valid token. Each HTTP request is
 * authenticated independently by its bearer token, which is the request-level
 * equivalent of session binding.
 */

declare module "express-serve-static-core" {
  interface Request {
    // Named `authContext` (not `auth`): the MCP SDK already augments Request
    // with its own `auth?: AuthInfo`.
    authContext?: AuthContext;
  }
}

const REJECTIONS: Record<TokenRejection | "missing", { code: string; message: string }> = {
  missing: {
    code: "missing_token",
    message: "Missing Authorization header. Send 'Authorization: Bearer aik_live_…'.",
  },
  malformed: {
    code: "malformed_token",
    message: "Malformed bearer token. Expected format 'aik_live_…'.",
  },
  invalid: {
    code: "invalid_token",
    message: "Unknown bearer token.",
  },
  revoked: {
    code: "revoked_token",
    message: "This token has been revoked. Create a new one with `npm run token:create`.",
  },
  expired: {
    code: "expired_token",
    message: "This token has expired. Create a new one with `npm run token:create`.",
  },
};

function reject(res: Response, reason: TokenRejection | "missing"): void {
  const { code, message } = REJECTIONS[reason];
  res.status(401).set("WWW-Authenticate", 'Bearer realm="mcp"').json({ error: { code, message } });
}

export function bearerAuth(db: Db): RequestHandler {
  return async function (req: Request, res: Response, next: NextFunction): Promise<void> {
    const header = req.headers.authorization;
    const raw = header?.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : undefined;
    if (!raw) {
      reject(res, "missing");
      return;
    }

    let result;
    try {
      result = await resolveToken(db, raw);
    } catch (error) {
      next(error);
      return;
    }
    if (!result.ok) {
      reject(res, result.reason);
      return;
    }

    req.authContext = result.auth;
    next();
  };
}

/** Read the authenticated context; throws if the middleware did not run. */
export function requireAuth(req: Request): AuthContext {
  if (!req.authContext) throw new Error("requireAuth called without bearerAuth middleware");
  return req.authContext;
}
