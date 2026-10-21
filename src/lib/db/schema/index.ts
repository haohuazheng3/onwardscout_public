/*
 * The whole database schema: platform tables (./base.ts, F1) and product tables (./domain.ts, F2).
 * drizzle.config.ts points here, and `db` (src/lib/db/index.ts) is typed with it.
 */
export * from "./base";
export * from "./domain";
