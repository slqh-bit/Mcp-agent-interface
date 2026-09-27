/**
 * Token scopes (plan §6). A token carries a subset of these; tools check them
 * from Cycle 3 onward. The middleware only authenticates — scope enforcement
 * per tool arrives with defineTool() in Cycle 3.
 */

export const SCOPES = [
  "tenders:read",
  "tracking:read",
  "tracking:write",
  "searches:write",
  "alerts:read",
] as const;

export type Scope = (typeof SCOPES)[number];

export function isScope(value: string): value is Scope {
  return (SCOPES as readonly string[]).includes(value);
}

/**
 * Validate a list of scope strings. Throws listing every unknown scope, so a
 * typo in the CLI fails loudly instead of silently granting nothing.
 */
export function validateScopes(values: string[]): Scope[] {
  const unknown = values.filter((v) => !isScope(v));
  if (unknown.length > 0) {
    throw new Error(`Unknown scope(s): ${unknown.join(", ")}. Valid scopes: ${SCOPES.join(", ")}`);
  }
  return values as Scope[];
}

export function hasScope(granted: readonly string[], required: Scope): boolean {
  return granted.includes(required);
}
