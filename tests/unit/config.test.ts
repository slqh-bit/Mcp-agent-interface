import { describe, expect, it } from "vitest";

import { loadConfig } from "../../src/config.js";

const validEnv = {
  PORT: "3000",
  DATABASE_URL: "postgresql://postgres:postgres@localhost:5433/agent_interface_kit",
  LOG_LEVEL: "debug",
};

describe("loadConfig", () => {
  it("parses and coerces a valid env", () => {
    const config = loadConfig({ ...validEnv });
    expect(config.PORT).toBe(3000);
    expect(config.LOG_LEVEL).toBe("debug");
    expect(config.NODE_ENV).toBe("development");
  });

  it("fails fast when DATABASE_URL is missing", () => {
    expect(() => loadConfig({ PORT: "3000" })).toThrow(/Invalid environment configuration/);
  });

  it("fails fast on an invalid LOG_LEVEL", () => {
    expect(() => loadConfig({ ...validEnv, LOG_LEVEL: "chatty" })).toThrow(/LOG_LEVEL/);
  });

  it("fails fast on a non-numeric PORT", () => {
    expect(() => loadConfig({ ...validEnv, PORT: "abc" })).toThrow(/PORT/);
  });
});
