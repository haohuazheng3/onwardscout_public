// Applies the drizzle/ migrations (idempotent: drizzle records what already ran in
// drizzle.__drizzle_migrations). Runs at the start of every build; skips cleanly when no
// database is configured (CI, a fresh clone). Uses the direct (unpooled) connection over
// WebSockets because migrations run in a transaction.
import { existsSync } from "node:fs";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { migrate } from "drizzle-orm/neon-serverless/migrator";

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
  console.log("[migrate] no DATABASE_URL_UNPOOLED / DATABASE_URL: skipping migrations");
  process.exit(0);
}
if (!existsSync("drizzle/meta/_journal.json")) {
  console.log("[migrate] no migrations in ./drizzle yet (run `npm run db:generate`): skipping");
  process.exit(0);
}
if (typeof WebSocket !== "undefined") neonConfig.webSocketConstructor = WebSocket;
const pool = new Pool({ connectionString: url });
const started = Date.now();
try {
  await migrate(drizzle(pool), { migrationsFolder: "drizzle" });
  console.log(`[migrate] migrations applied (${Date.now() - started} ms)`);
} catch (err) {
  // Never print the connection string; the driver's message names the failing statement.
  console.error("[migrate] failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
