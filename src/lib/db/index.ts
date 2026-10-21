import "server-only";
import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "./schema";

/**
 * Neon over HTTP: one round trip per query, no connection pool to exhaust on serverless.
 * There are no interactive transactions, so every write is designed to be idempotent
 * (unique keys + ON CONFLICT) and balance-like movements are guarded by conditional UPDATEs
 * rather than read-then-write. `db.batch([...])` runs several statements in one implicit
 * transaction when they must land together.
 *
 * The client is created lazily so pages that never touch the database (and the build
 * itself) work without DATABASE_URL.
 */
export type Db = NeonHttpDatabase<typeof schema>;

let instance: Db | null = null;

export function getDb(): Db {
  if (!instance) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not configured");
    instance = drizzle(neon(url), { schema });
  }
  return instance;
}

/** The shared client. Property access is forwarded to the lazily created instance. */
export const db = new Proxy({} as Db, {
  get(_target, prop) {
    const real = getDb();
    const value = Reflect.get(real, prop, real);
    return typeof value === "function" ? value.bind(real) : value;
  },
});

export { schema };
