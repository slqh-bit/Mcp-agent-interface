import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup-env.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
