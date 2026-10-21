/*
 * Platform tables (F1). Product tables live in ./domain.ts; ./index.ts re-exports both and is
 * the schema drizzle-kit reads. All timestamps are timestamptz. Writes are idempotent (unique
 * keys + ON CONFLICT) because Neon over HTTP has no interactive transactions.
 */
import { sql } from "drizzle-orm";
import { date, doublePrecision, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

/* ------------------------------------------------------------------ accounts */

export type UserLocale = "en" | "zh";

/**
 * A person, keyed by the Clerk user id; upserted from the session by `ensureUser()` on the
 * first authenticated request. `inbound_token` is minted once and names the user's reply
 * drop-box `in+<token>@onwardscout.com`.
 */
export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    locale: text("locale").$type<UserLocale>().notNull().default("en"),
    inboundToken: text("inbound_token"),
    stripeCustomerId: text("stripe_customer_id"),
    createdAt: createdAt(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("users_inbound_token_uq").on(t.inboundToken),
    index("users_email_idx").on(t.email),
    index("users_stripe_customer_idx").on(t.stripeCustomerId),
  ],
);

/* ------------------------------------------------------------------ billing ledger */

export type StripeEventStatus = "received" | "processed" | "ignored" | "failed";

/** Every Stripe event we accepted, keyed by event id: the webhook's idempotency ledger. */
export const stripeEvents = pgTable(
  "stripe_events",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(),
    status: text("status").$type<StripeEventStatus>().notNull().default("received"),
    error: text("error"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (t) => [index("stripe_events_received_idx").on(t.receivedAt)],
);

/* ------------------------------------------------------------------ operations */

export type ErrorSourceKind = "server" | "client" | "edge" | "worker" | "cron";
export type ErrorSeverity = "error" | "warn";

/** Self-hosted error inbox: one row per fingerprint (error name + first stack frame + route). */
export const errorGroups = pgTable(
  "error_groups",
  {
    id: text("id").primaryKey(),
    fingerprint: text("fingerprint").notNull(),
    name: text("name").notNull(),
    message: text("message").notNull(),
    route: text("route"),
    source: text("source").$type<ErrorSourceKind>().notNull(),
    severity: text("severity").$type<ErrorSeverity>().notNull().default("error"),
    firstFrame: text("first_frame"),
    stack: text("stack"),
    context: jsonb("context").$type<Record<string, unknown>>(),
    count: integer("count").notNull().default(1),
    firstSeen: timestamp("first_seen", { withTimezone: true }).notNull().defaultNow(),
    lastSeen: timestamp("last_seen", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("error_groups_fingerprint_uq").on(t.fingerprint),
    index("error_groups_open_idx").on(t.resolvedAt, t.severity, t.lastSeen),
  ],
);

export type ContactStatus = "new" | "replied" | "archived";

/** Messages from the public contact form (/contact → /api/contact). */
export const contactMessages = pgTable(
  "contact_messages",
  {
    id: text("id").primaryKey(),
    name: text("name"),
    email: text("email").notNull(),
    topic: text("topic").notNull(),
    message: text("message").notNull(),
    locale: text("locale").$type<UserLocale>(),
    userId: text("user_id"),
    ipHash: text("ip_hash"),
    userAgent: text("user_agent"),
    status: text("status").$type<ContactStatus>().notNull().default("new"),
    notified: integer("notified").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("contact_messages_created_idx").on(t.createdAt), index("contact_messages_status_idx").on(t.status, t.createdAt)],
);

export type InboxKind = "test" | "reply";

/**
 * Mail received by the onwardscout-mail worker (Cloudflare Email Routing → /api/inbox/ingest).
 * `kind = 'test'`: test@ and the catch-all (sign-in codes in automated tests, misc mail).
 * `kind = 'reply'`: a user's reply drop-box `in+<token>@`; `user_id` is resolved from the token.
 */
export const inboxMessages = pgTable(
  "inbox_messages",
  {
    id: text("id").primaryKey(),
    kind: text("kind").$type<InboxKind>().notNull().default("test"),
    userId: text("user_id"),
    toAddr: text("to_addr").notNull(),
    fromAddr: text("from_addr").notNull(),
    subject: text("subject"),
    textBody: text("text_body"),
    htmlBody: text("html_body"),
    spf: text("spf"),
    dkim: text("dkim"),
    dmarc: text("dmarc"),
    authResults: text("auth_results"),
    headers: jsonb("headers").$type<Record<string, string>>(),
    rawSize: integer("raw_size").notNull().default(0),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("inbox_messages_to_idx").on(t.toAddr, t.receivedAt),
    index("inbox_messages_user_idx").on(t.userId, t.receivedAt),
    index("inbox_messages_kind_idx").on(t.kind, t.receivedAt),
  ],
);

/** Fixed-window rate limiter state (src/lib/ratelimit.ts). */
export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull().defaultNow(),
  count: integer("count").notNull().default(0),
});

/** Daily Search Console rows pulled by scripts/gsc-pull.mjs. */
export const gscDaily = pgTable(
  "gsc_daily",
  {
    day: date("day").notNull(),
    page: text("page").notNull(),
    query: text("query").notNull(),
    clicks: integer("clicks").notNull().default(0),
    impressions: integer("impressions").notNull().default(0),
    ctr: doublePrecision("ctr").notNull().default(0),
    position: doublePrecision("position").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.day, t.page, t.query] })],
);

/** Small key/value store for operational state (last cron runs, alert throttles, reconcile reports…). */
export const appState = pgTable("app_state", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>(),
  updatedAt: updatedAt(),
});

/* ------------------------------------------------------------------ sandbox */

/** A file field of a sandbox submission: metadata only, the bytes are discarded. */
export interface SandboxFileMeta {
  field: string;
  name: string;
  size: number;
  type: string;
}

/**
 * Submissions to our own practice form (/sandbox/form). Every automated submission test and the
 * built-in "Practice application" target this table, never a real third party.
 * `ref` is the confirmation reference shown to the submitter (e.g. SBX-7KQ2M9).
 */
export const sandboxSubmissions = pgTable(
  "sandbox_submissions",
  {
    id: text("id").primaryKey(),
    ref: text("ref").notNull(),
    fields: jsonb("fields").$type<Record<string, string>>().notNull().default(sql`'{}'::jsonb`),
    files: jsonb("files").$type<SandboxFileMeta[]>().notNull().default(sql`'[]'::jsonb`),
    userAgent: text("user_agent"),
    ipHash: text("ip_hash"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("sandbox_submissions_ref_uq").on(t.ref), index("sandbox_submissions_created_idx").on(t.createdAt)],
);

/* ------------------------------------------------------------------ row types */

export type UserRow = typeof users.$inferSelect;
export type StripeEventRow = typeof stripeEvents.$inferSelect;
export type ErrorGroupRow = typeof errorGroups.$inferSelect;
export type ContactMessageRow = typeof contactMessages.$inferSelect;
export type InboxMessageRow = typeof inboxMessages.$inferSelect;
export type GscDailyRow = typeof gscDaily.$inferSelect;
export type AppStateRow = typeof appState.$inferSelect;
export type SandboxSubmissionRow = typeof sandboxSubmissions.$inferSelect;
