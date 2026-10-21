import "server-only";
import { eq, inArray, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { db } from "@/lib/db";
import {
  appState,
  applicationSteps,
  applications,
  authorizations,
  contactMessages,
  contacts,
  creditEvents,
  creditLots,
  documents,
  events,
  facts,
  generatedDocuments,
  goals,
  inboxMessages,
  integrations,
  jobs,
  llmCalls,
  matches,
  messages,
  milestones,
  notifications,
  opportunities,
  opportunitySnapshots,
  orders,
  profileVersions,
  profiles,
  sandboxSubmissions,
  subscriptions,
  users,
  userTombstones,
} from "@/lib/db/schema";
import { tombstoneHash } from "@/lib/crypto";
import { env } from "@/lib/env";
import { deleteObject, deleteUserObjects, userPrefixes } from "@/lib/files";
import { sha256 } from "@/lib/ids";
import { SITE } from "@/lib/site";
import { parsePrefs, prefsKey } from "./authorizations";

/*
 * The person's data (P6): the JSON export behind "Download my data" and the erasure behind
 * "Delete my account" (and the nightly clean-up of abandoned anonymous drafts).
 *
 * The export is built from explicit allow-lists of columns per table, never by spreading a
 * row, so a column added later (or a secret such as an encrypted Gmail refresh token, the
 * reply drop-box token or Stripe identifiers) can never leak into a download by accident.
 */

export const EXPORT_FORMAT = "onward-scout-export";
export const EXPORT_VERSION = 1;

type Row = Record<string, unknown>;

/** Copies only the listed keys (Dates become ISO strings). */
export function pick<T extends Row, K extends keyof T & string>(row: T, keys: readonly K[]): Record<K, unknown> {
  const out = {} as Record<K, unknown>;
  for (const k of keys) {
    const v = row[k];
    out[k] = v instanceof Date ? v.toISOString() : (v ?? null);
  }
  return out;
}

/* ------------------------------------------------------------------ allow-lists */

export const EXPORT_FIELDS = {
  account: ["id", "email", "locale", "createdAt", "lastSeenAt"],
  profile: [
    "version",
    "status",
    "completeness",
    "summary",
    "identity",
    "roles",
    "industries",
    "functions",
    "occupations",
    "education",
    "experience",
    "projects",
    "skills",
    "achievements",
    "publications",
    "certifications",
    "packs",
    "createdAt",
    "updatedAt",
  ],
  profileVersions: ["version", "snapshot", "createdAt"],
  documents: ["id", "kind", "filename", "contentType", "bytes", "sourceUrl", "status", "error", "createdAt"],
  facts: ["id", "path", "claim", "value", "sourceDocId", "quote", "confidence", "confirmedByUser", "createdAt", "updatedAt"],
  goals: ["id", "family", "sub", "label", "successDefinition", "horizonMonths", "constraints", "status", "createdAt", "updatedAt"],
  milestones: ["id", "goalId", "title", "metric", "target", "current", "dueAt", "status", "position", "createdAt", "updatedAt"],
  matches: ["opportunityId", "goalId", "fit", "winProbability", "effort", "value", "reasons", "gaps", "rank", "feedback", "feedbackReason", "createdAt", "updatedAt"],
  opportunities: ["id", "type", "name", "orgName", "url", "deadline", "status"],
  applications: [
    "id",
    "goalId",
    "opportunityId",
    "channel",
    "status",
    "needsYouReason",
    "questions",
    "answers",
    "submittedAt",
    "externalRef",
    "evidence",
    "outcome",
    "creditsReserved",
    "practice",
    "followUpAt",
    "followUpsSent",
    "createdAt",
    "updatedAt",
  ],
  applicationSteps: ["applicationId", "n", "kind", "status", "input", "output", "error", "startedAt", "finishedAt"],
  generatedDocuments: ["id", "applicationId", "kind", "title", "language", "content", "sources", "version", "createdAt"],
  contacts: ["id", "kind", "name", "email", "org", "role", "url", "source", "notes", "doNotContact", "lastContactedAt", "createdAt"],
  messages: ["id", "applicationId", "contactId", "direction", "channel", "subject", "bodyText", "toAddr", "fromAddr", "status", "classification", "sentAt", "receivedAt", "createdAt"],
  events: ["kind", "applicationId", "opportunityId", "data", "createdAt"],
  notifications: ["kind", "title", "body", "href", "readAt", "emailedAt", "createdAt"],
  authorizations: ["scope", "grantedAt", "revokedAt"],
  integrations: ["provider", "scopes", "accountEmail", "status", "createdAt", "updatedAt"],
  creditLots: ["kind", "total", "remaining", "status", "expiresAt", "createdAt"],
  creditEvents: ["kind", "amount", "applicationId", "createdAt"],
  orders: ["kind", "sku", "amountTotal", "currency", "status", "promoCode", "createdAt"],
  subscriptions: ["sku", "status", "currentPeriodStart", "currentPeriodEnd", "cancelAtPeriodEnd"],
  contactMessages: ["topic", "message", "createdAt"],
  sandboxSubmissions: ["ref", "fields", "files", "createdAt"],
  importedOpportunities: ["id", "type", "name", "orgName", "url", "deadline", "status", "createdAt"],
} as const;

/** Columns that must never appear in an export, whatever a future allow-list says. */
export const NEVER_EXPORTED = [
  "refreshTokenEnc",
  "inboundToken",
  "stripeCustomerId",
  "stripeSessionId",
  "stripeSubscriptionId",
  "stripePaymentIntent",
  "stripeInvoiceId",
  "objectKey",
  "screenshotKey",
  "gmailMessageId",
  "gmailThreadId",
  "ipHash",
] as const;

export interface ExportSource {
  user: Row | null;
  profile: Row | null;
  profileVersions: Row[];
  documents: Row[];
  facts: Row[];
  goals: Row[];
  milestones: Row[];
  matches: Row[];
  opportunities: Row[];
  applications: Row[];
  applicationSteps: Row[];
  generatedDocuments: Row[];
  contacts: Row[];
  messages: Row[];
  events: Row[];
  notifications: Row[];
  authorizations: Row[];
  integrations: Row[];
  creditLots: Row[];
  creditEvents: Row[];
  orders: Row[];
  subscriptions: Row[];
  contactMessages: Row[];
  /** What our practice form stored for this person's practice runs. */
  sandboxSubmissions?: Row[];
  /** Opportunities this person added by link (private to them). */
  importedOpportunities?: Row[];
  preferences: unknown;
}

export interface ExportDocument {
  format: typeof EXPORT_FORMAT;
  version: number;
  exportedAt: string;
  service: string;
  notes: string[];
  account: Record<string, unknown> | null;
  preferences: ReturnType<typeof parsePrefs>;
  profile: Record<string, unknown> | null;
  profileVersions: Record<string, unknown>[];
  documents: Record<string, unknown>[];
  facts: Record<string, unknown>[];
  goals: Record<string, unknown>[];
  milestones: Record<string, unknown>[];
  matches: Record<string, unknown>[];
  opportunities: Record<string, unknown>[];
  applications: Record<string, unknown>[];
  applicationSteps: Record<string, unknown>[];
  generatedDocuments: Record<string, unknown>[];
  contacts: Record<string, unknown>[];
  messages: Record<string, unknown>[];
  events: Record<string, unknown>[];
  notifications: Record<string, unknown>[];
  authorizations: Record<string, unknown>[];
  integrations: Record<string, unknown>[];
  credits: { lots: Record<string, unknown>[]; events: Record<string, unknown>[] };
  orders: Record<string, unknown>[];
  subscriptions: Record<string, unknown>[];
  contactMessages: Record<string, unknown>[];
  sandboxSubmissions: Record<string, unknown>[];
  importedOpportunities: Record<string, unknown>[];
}

export const EXPORT_NOTES = [
  "This file holds everything Onward Scout stores about you, as of the time above.",
  "Uploaded files themselves are not inside this file: download them from Documents in the app. Their names, sizes and parse status are listed under documents.",
  "Payment card details are held by Stripe and sign-in details by Clerk; we never receive them.",
  "Security secrets (the encrypted Gmail token, internal storage keys and Stripe references) are left out on purpose.",
] as const;

/** Builds the export from raw rows (pure; every table goes through its allow-list). */
export function buildExport(src: ExportSource, now = new Date()): ExportDocument {
  const many = <K extends keyof typeof EXPORT_FIELDS>(rows: Row[], key: K) => rows.map((r) => pick(r, EXPORT_FIELDS[key] as readonly string[]));
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: now.toISOString(),
    service: `${SITE.name} (${SITE.domain})`,
    notes: [...EXPORT_NOTES],
    account: src.user ? pick(src.user, EXPORT_FIELDS.account) : null,
    preferences: parsePrefs(src.preferences),
    profile: src.profile ? pick(src.profile, EXPORT_FIELDS.profile) : null,
    profileVersions: many(src.profileVersions, "profileVersions"),
    documents: many(src.documents, "documents"),
    facts: many(src.facts, "facts"),
    goals: many(src.goals, "goals"),
    milestones: many(src.milestones, "milestones"),
    matches: many(src.matches, "matches"),
    opportunities: many(src.opportunities, "opportunities"),
    applications: many(src.applications, "applications"),
    applicationSteps: many(src.applicationSteps, "applicationSteps"),
    generatedDocuments: many(src.generatedDocuments, "generatedDocuments"),
    contacts: many(src.contacts, "contacts"),
    messages: many(src.messages, "messages"),
    events: many(src.events, "events"),
    notifications: many(src.notifications, "notifications"),
    authorizations: many(src.authorizations, "authorizations"),
    integrations: many(src.integrations, "integrations"),
    credits: { lots: many(src.creditLots, "creditLots"), events: many(src.creditEvents, "creditEvents") },
    orders: many(src.orders, "orders"),
    subscriptions: many(src.subscriptions, "subscriptions"),
    contactMessages: many(src.contactMessages, "contactMessages"),
    sandboxSubmissions: many(src.sandboxSubmissions ?? [], "sandboxSubmissions"),
    importedOpportunities: many(src.importedOpportunities ?? [], "importedOpportunities"),
  };
}

export function exportFilename(now = new Date()): string {
  return `onward-scout-data-${now.toISOString().slice(0, 10)}.json`;
}

/* ------------------------------------------------------------------ collection */

/** Every row we hold for one user (scoped by user id everywhere). */
export async function collectUserData(userId: string): Promise<ExportSource> {
  const [user, profile, docRows, factRows, goalRows, milestoneRows, matchRows, appRows, genRows, contactRows, messageRows, eventRows, ntfRows, autRows, intRows, lotRows, cevRows, orderRows, subRows, cmRows, prefRows] =
    await Promise.all([
      db.select().from(users).where(eq(users.id, userId)).limit(1),
      db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1),
      db.select().from(documents).where(eq(documents.userId, userId)),
      db.select().from(facts).where(eq(facts.userId, userId)),
      db.select().from(goals).where(eq(goals.userId, userId)),
      db.select().from(milestones).where(eq(milestones.userId, userId)),
      db.select().from(matches).where(eq(matches.userId, userId)),
      db.select().from(applications).where(eq(applications.userId, userId)),
      db.select().from(generatedDocuments).where(eq(generatedDocuments.userId, userId)),
      db.select().from(contacts).where(eq(contacts.userId, userId)),
      db.select().from(messages).where(eq(messages.userId, userId)),
      db.select().from(events).where(eq(events.userId, userId)),
      db.select().from(notifications).where(eq(notifications.userId, userId)),
      db.select().from(authorizations).where(eq(authorizations.userId, userId)),
      db.select().from(integrations).where(eq(integrations.userId, userId)),
      db.select().from(creditLots).where(eq(creditLots.userId, userId)),
      db.select().from(creditEvents).where(eq(creditEvents.userId, userId)),
      db.select().from(orders).where(eq(orders.userId, userId)),
      db.select().from(subscriptions).where(eq(subscriptions.userId, userId)),
      db.select().from(contactMessages).where(eq(contactMessages.userId, userId)),
      db.select({ value: appState.value }).from(appState).where(eq(appState.key, prefsKey(userId))).limit(1),
    ]);
  const profileRow = profile[0] ?? null;
  const appIds = appRows.map((a) => a.id);
  const oppIds = [...new Set([...appRows.map((a) => a.opportunityId), ...matchRows.map((m) => m.opportunityId)])];
  const [versionRows, stepRows, oppRows, sandboxRows, importedRows] = await Promise.all([
    profileRow ? db.select().from(profileVersions).where(eq(profileVersions.profileId, profileRow.id)) : Promise.resolve([]),
    appIds.length ? db.select().from(applicationSteps).where(inArray(applicationSteps.applicationId, appIds)) : Promise.resolve([]),
    oppIds.length
      ? db
          .select({ id: opportunities.id, type: opportunities.type, name: opportunities.name, orgName: opportunities.orgName, url: opportunities.url, deadline: opportunities.deadline, status: opportunities.status })
          .from(opportunities)
          .where(inArray(opportunities.id, oppIds))
      : Promise.resolve([]),
    appIds.length
      ? db
          .select({ ref: sandboxSubmissions.ref, fields: sandboxSubmissions.fields, files: sandboxSubmissions.files, createdAt: sandboxSubmissions.createdAt })
          .from(sandboxSubmissions)
          .where(inArray(sql`${sandboxSubmissions.fields}->>'application_id'`, appIds))
      : Promise.resolve([]),
    db
      .select({ id: opportunities.id, type: opportunities.type, name: opportunities.name, orgName: opportunities.orgName, url: opportunities.url, deadline: opportunities.deadline, status: opportunities.status, createdAt: opportunities.createdAt })
      .from(opportunities)
      .where(sql`starts_with(coalesce(${opportunities.sourceRef}, ''), ${ownRef(userId)})`),
  ]);
  return {
    user: user[0] ?? null,
    profile: profileRow,
    profileVersions: versionRows,
    documents: docRows,
    facts: factRows,
    goals: goalRows,
    milestones: milestoneRows,
    matches: matchRows,
    opportunities: oppRows,
    applications: appRows,
    applicationSteps: stepRows,
    generatedDocuments: genRows,
    contacts: contactRows,
    messages: messageRows,
    events: eventRows,
    notifications: ntfRows,
    authorizations: autRows,
    integrations: intRows,
    creditLots: lotRows,
    creditEvents: cevRows,
    orders: orderRows,
    subscriptions: subRows,
    contactMessages: cmRows,
    sandboxSubmissions: sandboxRows,
    importedOpportunities: importedRows,
    preferences: prefRows[0]?.value ?? null,
  };
}

/* ------------------------------------------------------------------ erasure */

/** Stripe statuses under which deleting the account would leave a renewing subscription behind. */
export const RENEWING_STATUSES = ["active", "trialing", "past_due", "unpaid", "incomplete"] as const;

/** A subscription that would keep renewing after the account is gone (pure). */
export function renewingSubscription<T extends { status: string; cancelAtPeriodEnd: boolean }>(rows: readonly T[]): T | null {
  return rows.find((r) => (RENEWING_STATUSES as readonly string[]).includes(r.status) && !r.cancelAtPeriodEnd) ?? null;
}

export async function blockingSubscription(userId: string): Promise<{ sku: string; status: string } | null> {
  const rows = await db
    .select({ sku: subscriptions.sku, status: subscriptions.status, cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd })
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId));
  const r = renewingSubscription(rows);
  return r ? { sku: r.sku, status: r.status } : null;
}

/** Orders are kept for the books with the person removed: this replaces their user id. */
export function anonymizedUserId(userId: string): string {
  return `deleted_${sha256(`onward-scout:${userId}`).slice(0, 20)}`;
}

export interface DeletionReport {
  objects: number;
  applications: number;
  documents: number;
  clerk: "deleted" | "not-found" | "skipped";
}

function filesConfigured(): boolean {
  return Boolean(env("FILES_BASE_URL") && env("FILES_API_TOKEN"));
}

/**
 * Erases one person: their files in R2 first (so no object outlives its row) — every key under
 * their prefixes plus any file their rows point to elsewhere — then every
 * user-scoped row in one batch (an implicit transaction), then — for a real account — the
 * Clerk user. Payment records are kept for the books with the user id replaced and the email
 * removed; LLM cost rows lose their user id. Safe to repeat.
 */
export async function deleteUserData(userId: string, opts: { clerk: boolean }): Promise<DeletionReport> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(userId)) throw new Error("deleteUserData: unexpected user id");

  const [appRows, profileRows, docRows, genRows] = await Promise.all([
    db.select({ id: applications.id }).from(applications).where(eq(applications.userId, userId)),
    db.select({ id: profiles.id }).from(profiles).where(eq(profiles.userId, userId)),
    db.select({ objectKey: documents.objectKey }).from(documents).where(eq(documents.userId, userId)),
    db.select({ objectKey: generatedDocuments.objectKey }).from(generatedDocuments).where(eq(generatedDocuments.userId, userId)),
  ]);
  const appIds = appRows.map((a) => a.id);
  const profileIds = profileRows.map((p) => p.id);
  const stepRows = appIds.length
    ? await db.select({ key: applicationSteps.screenshotKey }).from(applicationSteps).where(inArray(applicationSteps.applicationId, appIds))
    : [];

  let objects = 0;
  if (filesConfigured()) {
    objects += await deleteUserObjects(userId);
    // Files that live under another prefix (a claimed anonymous draft keeps its `docs/anon_…/` key).
    const prefixes = userPrefixes(userId);
    const stray = new Set(
      [...docRows.map((d) => d.objectKey), ...genRows.map((g) => g.objectKey), ...stepRows.map((r) => r.key)].filter(
        (k): k is string => Boolean(k) && !prefixes.some((p) => k!.startsWith(p)),
      ),
    );
    for (const key of stray) {
      await deleteObject(key);
      objects++;
    }
  }

  const statements: BatchItem<"pg">[] = [
    ...(appIds.length ? [db.delete(applicationSteps).where(inArray(applicationSteps.applicationId, appIds))] : []),
    ...(profileIds.length ? [db.delete(profileVersions).where(inArray(profileVersions.profileId, profileIds))] : []),
    db.delete(facts).where(eq(facts.userId, userId)),
    db.delete(documents).where(eq(documents.userId, userId)),
    db.delete(milestones).where(eq(milestones.userId, userId)),
    db.delete(goals).where(eq(goals.userId, userId)),
    db.delete(matches).where(eq(matches.userId, userId)),
    db.delete(generatedDocuments).where(eq(generatedDocuments.userId, userId)),
    db.delete(applications).where(eq(applications.userId, userId)),
    db.delete(messages).where(eq(messages.userId, userId)),
    db.delete(contacts).where(eq(contacts.userId, userId)),
    db.delete(events).where(eq(events.userId, userId)),
    db.delete(notifications).where(eq(notifications.userId, userId)),
    db.delete(authorizations).where(eq(authorizations.userId, userId)),
    db.delete(integrations).where(eq(integrations.userId, userId)),
    db.delete(jobs).where(eq(jobs.userId, userId)),
    db.delete(creditEvents).where(eq(creditEvents.userId, userId)),
    db.delete(creditLots).where(eq(creditLots.userId, userId)),
    db.delete(subscriptions).where(eq(subscriptions.userId, userId)),
    db.delete(inboxMessages).where(eq(inboxMessages.userId, userId)),
    db.delete(contactMessages).where(eq(contactMessages.userId, userId)),
    db.update(llmCalls).set({ userId: null }).where(eq(llmCalls.userId, userId)),
    db.update(orders).set({ userId: anonymizedUserId(userId), email: null, updatedAt: sql`now()` }).where(eq(orders.userId, userId)),
    db.delete(appState).where(eq(appState.key, prefsKey(userId))),
    // Practice runs: what the sandbox form stored for this person's applications.
    ...(appIds.length ? [db.delete(sandboxSubmissions).where(inArray(sql`${sandboxSubmissions.fields}->>'application_id'`, appIds))] : []),
    // Links this person imported: removed when nobody else applied to or was matched with them,
    // otherwise kept with the person's id taken out of the reference.
    db.delete(opportunitySnapshots).where(sql`${opportunitySnapshots.opportunityId} in (select o.id from opportunities o where ${importedOnlyBy(userId)})`),
    db.delete(opportunities).where(sql`${opportunities.id} in (select o.id from opportunities o where ${importedOnlyBy(userId)})`),
    db
      .update(opportunities)
      .set({ sourceRef: sql`${`user:${anonymizedUserId(userId)}:`} || substr(${opportunities.sourceRef}, ${ownRef(userId).length + 1})`, updatedAt: sql`now()` })
      .where(sql`starts_with(coalesce(${opportunities.sourceRef}, ''), ${ownRef(userId)})`),
    db.delete(profiles).where(eq(profiles.userId, userId)),
    db.delete(users).where(eq(users.id, userId)),
    // A real account leaves a tombstone (a keyed hash, not the id): a still-valid session cannot
    // recreate it, and Stripe events cannot grant it credits again.
    ...(opts.clerk ? [db.insert(userTombstones).values({ userHash: tombstoneHash(userId) }).onConflictDoNothing()] : []),
  ];
  await db.batch(statements as [BatchItem<"pg">, ...BatchItem<"pg">[]]);

  let clerk: DeletionReport["clerk"] = "skipped";
  if (opts.clerk) {
    try {
      // Loaded lazily: the export side of this module stays free of the Clerk SDK (tests, scripts).
      const { clerkClient } = await import("@clerk/nextjs/server");
      const client = await clerkClient();
      await client.users.deleteUser(userId);
      clerk = "deleted";
    } catch (err) {
      const status = (err as { status?: number } | null)?.status;
      if (status === 404) clerk = "not-found";
      else throw err;
    }
  }
  return { objects, applications: appIds.length, documents: docRows.length, clerk };
}

function ownRef(userId: string): string {
  return `user:${userId}:`;
}

/** SQL over alias `o`: an opportunity this person imported that no other person uses. */
function importedOnlyBy(userId: string) {
  return sql`starts_with(coalesce(o.source_ref, ''), ${ownRef(userId)})
    and not exists (select 1 from applications a where a.opportunity_id = o.id and a.user_id <> ${userId})
    and not exists (select 1 from matches m where m.opportunity_id = o.id and m.user_id <> ${userId})`;
}

/* ------------------------------------------------------------------ anonymous drafts */

/**
 * Anonymous visitors' ids (`anon_*`) to erase: the newest draft row is older than `days`
 * (abandoned), or the oldest is older than `maxAgeDays` (the privacy policy keeps an unclaimed
 * draft "at most 30 days", however recently it was touched).
 */
export async function staleAnonymousIds(days = 7, limit = 100, maxAgeDays = 30): Promise<string[]> {
  const pattern = "anon\\_%";
  const result = await db.execute(sql`
    select user_id from (
      select user_id, max(created_at) as last, min(created_at) as first from documents where user_id like ${pattern} group by user_id
      union all
      select user_id, max(updated_at) as last, min(created_at) as first from profiles where user_id like ${pattern} group by user_id
      union all
      select user_id, max(updated_at) as last, min(created_at) as first from goals where user_id like ${pattern} group by user_id
      union all
      select user_id, max(updated_at) as last, min(created_at) as first from facts where user_id like ${pattern} group by user_id
    ) t
    group by user_id
    having max(last) < now() - make_interval(days => ${days}::int)
        or min(first) < now() - make_interval(days => ${maxAgeDays}::int)
    order by user_id
    limit ${limit}::int
  `);
  const rows = (result as unknown as { rows?: { user_id: string }[] }).rows ?? [];
  return rows.map((r) => r.user_id).filter((id) => /^anon_[A-Za-z0-9_-]{1,59}$/.test(id));
}

/** Deletes one anonymous draft (no Clerk user, no users row). */
export async function deleteAnonymousDraft(anonId: string): Promise<DeletionReport> {
  if (!anonId.startsWith("anon_")) throw new Error("deleteAnonymousDraft: not an anonymous id");
  return deleteUserData(anonId, { clerk: false });
}
