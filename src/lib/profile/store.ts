import "server-only";
import { and, asc, desc, eq, getTableColumns, inArray, sql } from "drizzle-orm";
import { profileIdentitySchema, type Profile, type ProfileStatus } from "@/lib/core/types";
import { db } from "@/lib/db";
import { facts, goals, profileVersions, profiles, type FactRow, type GoalRow, type ProfileRow } from "@/lib/db/schema";
import { newId } from "@/lib/ids";
import { readProfile } from "@/lib/llm/types";
import { completenessScore } from "./completeness";
import type { ConfirmedFact } from "./merge";

/*
 * Profile persistence. Neon over HTTP has no interactive transactions, so a profile write is
 * an optimistic compare-and-set on `updated_at` (re-read, re-apply, retry), and statements
 * that must land together go through `db.batch`.
 *
 * Versions (`profile_versions`): a new version (and snapshot) on every extraction, restore
 * and "looks right" confirmation, and whenever the current snapshot is older than ten
 * minutes; quick successive taps update the current version's snapshot in place, so the
 * history stays readable while every version still has a snapshot that matches it.
 */

const SNAPSHOT_FRESH_MS = 10 * 60 * 1000;

export type ProfileWithStamp = ProfileRow & { stamp: string };

const withStamp = { ...getTableColumns(profiles), stamp: sql<string>`${profiles.updatedAt}::text` };

/** The profile row of a person (or an anonymous draft), or null. */
export async function getProfile(userId: string): Promise<ProfileRow | null> {
  const rows = await db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
  return rows[0] ?? null;
}

async function profileWithStamp(userId: string): Promise<ProfileWithStamp | null> {
  const rows = await db.select(withStamp).from(profiles).where(eq(profiles.userId, userId)).limit(1);
  return rows[0] ?? null;
}

/** The profile document stored in a row's content columns. */
export function profileOf(row: Pick<ProfileRow, "identity" | "roles" | "industries" | "functions" | "occupations" | "education" | "experience" | "projects" | "skills" | "achievements" | "publications" | "certifications" | "packs" | "summary">): Profile {
  return readProfile({
    identity: row.identity,
    roles: row.roles,
    industries: row.industries,
    functions: row.functions,
    occupations: row.occupations,
    education: row.education,
    experience: row.experience,
    projects: row.projects,
    skills: row.skills,
    achievements: row.achievements,
    publications: row.publications,
    certifications: row.certifications,
    packs: row.packs,
    summary: row.summary,
  });
}

function columnsOf(p: Profile) {
  return {
    identity: p.identity,
    roles: p.roles,
    industries: p.industries,
    functions: p.functions,
    occupations: p.occupations,
    education: p.education,
    experience: p.experience,
    projects: p.projects,
    skills: p.skills,
    achievements: p.achievements,
    publications: p.publications,
    certifications: p.certifications,
    packs: p.packs,
    summary: p.summary,
  };
}

/** The person's profile row, created empty on first use (idempotent). */
export async function ensureProfile(userId: string): Promise<ProfileWithStamp> {
  const found = await profileWithStamp(userId);
  if (found) return found;
  await db
    .insert(profiles)
    .values({ id: newId("prf"), userId, identity: profileIdentitySchema.parse({}), status: "empty" })
    .onConflictDoNothing({ target: profiles.userId });
  const row = await profileWithStamp(userId);
  if (!row) throw new Error("profile row was not persisted");
  return row;
}

export interface WriteResult {
  profile: Profile;
  status?: ProfileStatus;
  /** Start a new version (extraction, restore, confirmation). */
  bump?: boolean;
}

/**
 * Read–modify–write with a compare-and-set on `updated_at`. `mutate` may run several times
 * (it is re-applied to fresh data after a concurrent write); return null to write nothing.
 */
export async function writeProfile(userId: string, mutate: (current: Profile, row: ProfileWithStamp) => WriteResult | null | Promise<WriteResult | null>, attempts = 5): Promise<ProfileRow> {
  for (let i = 0; i < attempts; i++) {
    const row = await ensureProfile(userId);
    const res = await mutate(profileOf(row), row);
    if (!res) return row;
    let bump = Boolean(res.bump);
    if (!bump) {
      const snap = await db
        .select({ createdAt: profileVersions.createdAt })
        .from(profileVersions)
        .where(and(eq(profileVersions.profileId, row.id), eq(profileVersions.version, row.version)))
        .limit(1);
      bump = Boolean(snap[0] && Date.now() - new Date(snap[0].createdAt).getTime() > SNAPSHOT_FRESH_MS);
    }
    const version = bump ? row.version + 1 : row.version;
    const profile = readProfile(res.profile);
    const updated = await db
      .update(profiles)
      .set({ ...columnsOf(profile), completeness: completenessScore(profile), status: res.status ?? row.status, version, updatedAt: sql`now()` })
      .where(and(eq(profiles.id, row.id), sql`${profiles.updatedAt}::text = ${row.stamp}`))
      .returning();
    const saved = updated[0];
    if (!saved) continue; // someone else wrote in between: re-read and re-apply
    await db
      .insert(profileVersions)
      .values({ id: newId("prf"), profileId: row.id, version, snapshot: profile })
      .onConflictDoUpdate({ target: [profileVersions.profileId, profileVersions.version], set: { snapshot: profile } });
    return saved;
  }
  throw new Error("Your profile is being updated elsewhere right now. Please try again in a moment.");
}

/** Sets only the status (e.g. "parsing" while an extraction runs). */
export async function setProfileStatus(userId: string, status: ProfileStatus, onlyFrom?: ProfileStatus[]): Promise<void> {
  const where = onlyFrom?.length ? and(eq(profiles.userId, userId), inArray(profiles.status, onlyFrom)) : eq(profiles.userId, userId);
  await db.update(profiles).set({ status, updatedAt: sql`now()` }).where(where);
}

/* ------------------------------------------------------------------ facts */

export async function getFacts(userId: string): Promise<FactRow[]> {
  return db.select().from(facts).where(eq(facts.userId, userId)).orderBy(asc(facts.createdAt));
}

/** The person's confirmed facts as merge input (path + value). */
export function confirmedOf(rows: readonly Pick<FactRow, "path" | "value" | "confirmedByUser">[]): ConfirmedFact[] {
  return rows.filter((f) => f.confirmedByUser).map((f) => ({ path: f.path, value: f.value }));
}

/**
 * Stores what the person said as confirmed facts: one confirmed fact per path (an earlier
 * answer at the same path is replaced), never touching document-sourced facts.
 */
export async function recordConfirmedFacts(userId: string, profileId: string, items: readonly { path: string; value: unknown; claim: string }[]): Promise<void> {
  if (!items.length) return;
  const statements = items.flatMap((f) => [
    // The latest word wins: an earlier answer goes, a confirmed document fact becomes a plain source again.
    db.delete(facts).where(and(eq(facts.userId, userId), eq(facts.path, f.path), eq(facts.confirmedByUser, true), sql`${facts.sourceDocId} is null`)),
    db
      .update(facts)
      .set({ confirmedByUser: false, updatedAt: sql`now()` })
      .where(and(eq(facts.userId, userId), eq(facts.path, f.path), eq(facts.confirmedByUser, true), sql`${facts.sourceDocId} is not null`)),
    db.insert(facts).values({
      id: newId("fct"),
      userId,
      profileId,
      path: f.path,
      claim: f.claim.slice(0, 500),
      value: (f.value ?? null) as FactRow["value"],
      sourceDocId: null,
      quote: null,
      confidence: 1,
      confirmedByUser: true,
    }),
  ]);
  await db.batch(statements as unknown as Parameters<typeof db.batch>[0]);
}

/* ------------------------------------------------------------------ goals */

export async function activeGoals(userId: string): Promise<GoalRow[]> {
  return db.select().from(goals).where(and(eq(goals.userId, userId), eq(goals.status, "active"))).orderBy(asc(goals.createdAt));
}

/** Recent profile versions, newest first (id, version, when, and the snapshot). */
export async function profileHistory(profileId: string, limit = 12) {
  return db
    .select({ id: profileVersions.id, version: profileVersions.version, createdAt: profileVersions.createdAt, snapshot: profileVersions.snapshot })
    .from(profileVersions)
    .where(eq(profileVersions.profileId, profileId))
    .orderBy(desc(profileVersions.version))
    .limit(limit);
}
