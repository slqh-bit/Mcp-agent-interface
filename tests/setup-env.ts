import { loadDotEnv } from "../src/lib/env.js";

// Integration tests run against the real local Postgres cluster (README).
// `.env` fills DATABASE_URL on dev machines; CI sets real env vars.
// Unit tests do not touch the database, so a missing DATABASE_URL only fails
// the integration files (testDb() throws with instructions).
loadDotEnv();
