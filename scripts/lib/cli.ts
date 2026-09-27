/**
 * Minimal `--flag value` / `--flag=value` argument parser for the CLI scripts.
 * No dependency; boolean flags declare themselves via `booleans`.
 */
export function parseArgs(
  argv: string[],
  booleans: readonly string[] = [],
): { flags: Record<string, string | true>; positional: string[] } {
  const flags: Record<string, string | true> = {};
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--") {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq !== -1) {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      } else {
        const name = arg.slice(2);
        if (booleans.includes(name)) {
          flags[name] = true;
        } else {
          const value = argv[++i];
          if (value === undefined) throw new Error(`Missing value for --${name}`);
          flags[name] = value;
        }
      }
    } else {
      positional.push(arg);
    }
  }
  return { flags, positional };
}

export function requireFlag(flags: Record<string, string | true>, name: string): string {
  const value = flags[name];
  if (typeof value !== "string" || value === "") throw new Error(`Missing required --${name}`);
  return value;
}
