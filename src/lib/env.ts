/**
 * Loads `.env` into process.env if present (Node >= 20.12 built-in, no
 * dependency). Existing environment variables always win — this only fills
 * gaps. Missing file is fine (CI sets real env vars).
 */
export function loadDotEnv(path = ".env"): void {
  try {
    process.loadEnvFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
}
