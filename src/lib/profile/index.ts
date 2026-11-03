import "server-only";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { applicationSteps, applications, documents, events, facts, generatedDocuments, goals, jobs, matches, milestones, notifications, orders, profileVersions, profiles } from "@/lib/db/schema";
import { captureError } from "@/lib/errors";
import { deleteObject } from "@/lib/files";
import { isAnonId } from "./anon-cookie";
import { queueExtraction } from "./pipeline";
import { getProfile, profileOf, recordConfirmedFacts, writeProfile } from "./store";

/*
 * The profile module (contracts §8). Consumers (P2a, P3a, P3b, P6) import from here:
 *
 *   getProfile(userId)      → ProfileRow | null   (use `profileOf(row)` for the Profile document)
 *   getFacts(userId)        → FactRow[]           (sourced claims; confirmed ones are the person's word)
 *   activeGoals(userId)     → GoalRow[]
 *   claimAnonymousDraft(anonId, userId) → { moved }
 *   ANON_COOKIE = "os_anon"
 *
 * plus the pure helpers mergeProfile, completenessScore and gapsFor (tested).
 */

export { ANON_COOKIE, isAnonId } from "./anon-cookie";
export { activeGoals, ensureProfile, getFacts, getProfile, profileOf, writeProfile } from "./store";
export { mergeProfile, planFactSync, valueAt } from "./merge";
export { completenessBreakdown, completenessNext, completenessScore } from "./completeness";
export { applyGapAnswer, gapsFor, type GapQuestion } from "./gaps";

/**
 * Moves everything an anonymous visitor built on /app/start (or /app/apply) to the account they
 * just signed in with: documents, facts, the profile (merged into an existing one by
 * re-extracting from all sources), goals with milestones, applications with their drafted
 * documents, notifications, events and pending jobs. Idempotent: a second call
 * finds nothing left to move. The sign-in email becomes a confirmed contact fact when the
 * profile has none.
 */
export async function claimAnonymousDraft(anonId: string, userId: string, opts: { email?: string; locale?: "en" | "zh" } = {}): Promise<{ moved: number }> {
  if (!isAnonId(anonId)) throw new Error("Not an anonymous draft id");
  if (!userId || isAnonId(userId)) throw new Error("Claiming needs a signed-in user");
  const anonProfile = await getProfile(anonId);
  const userProfile = await getProfile(userId);

  // An application the visitor started from a listing becomes theirs too — unless the account
  // already has one for that opportunity: then the account's stays and the draft's is dropped.
  const anonApps = await db.select({ id: applications.id, opportunityId: applications.opportunityId }).from(applications).where(eq(applications.userId, anonId));
  if (anonApps.length) {
    const taken = await db
      .select({ opportunityId: applications.opportunityId })
      .from(applications)
      .where(and(eq(applications.userId, userId), eq(applications.practice, false), inArray(applications.opportunityId, anonApps.map((a) => a.opportunityId))));
    const drop = anonApps.filter((a) => taken.some((t) => t.opportunityId === a.opportunityId)).map((a) => a.id);
    if (drop.length) {
      await db.batch([
        db.delete(generatedDocuments).where(and(eq(generatedDocuments.userId, anonId), inArray(generatedDocuments.applicationId, drop))),
        db.delete(applicationSteps).where(inArray(applicationSteps.applicationId, drop)),
        db.delete(applications).where(and(eq(applications.userId, anonId), inArray(applications.id, drop))),
      ]);
    }
  }

  const moved = await db.batch([
    db.update(applications).set({ userId, updatedAt: sql`now()` }).where(eq(applications.userId, anonId)).returning({ id: applications.id }),
    db.update(generatedDocuments).set({ userId }).where(eq(generatedDocuments.userId, anonId)).returning({ id: generatedDocuments.id }),
    db.update(notifications).set({ userId }).where(eq(notifications.userId, anonId)).returning({ id: notifications.id }),
    db.update(documents).set({ userId }).where(eq(documents.userId, anonId)).returning({ id: documents.id }),
    db.update(goals).set({ userId, updatedAt: sql`now()` }).where(eq(goals.userId, anonId)).returning({ id: goals.id }),
    db.update(milestones).set({ userId, updatedAt: sql`now()` }).where(eq(milestones.userId, anonId)).returning({ id: milestones.id }),
    db.update(events).set({ userId }).where(eq(events.userId, anonId)).returning({ id: events.id }),
    // A single-application purchase made signed out follows its application into the account.
    db.update(orders).set({ userId, updatedAt: sql`now()` }).where(eq(orders.userId, anonId)).returning({ id: orders.id }),
    db
      .update(jobs)
      .set({ userId, payload: sql`jsonb_set(${jobs.payload}, '{userId}', to_jsonb(${userId}::text), false)`, updatedAt: sql`now()` })
      .where(and(eq(jobs.userId, anonId), inArray(jobs.status, ["queued", "running"])))
      .returning({ id: jobs.id }),
  ]);
  let total = moved.reduce((n, rows) => n + rows.length, 0);
  let rebuild = false;

  // A profile row the account got just by opening a page (nothing read, nothing chosen) is
  // simply replaced by the draft.
  const userEmpty = Boolean(userProfile && userProfile.status === "empty" && userProfile.completeness === 0 && !userProfile.roles.length);

  // When the draft simply becomes the account's profile, its picks stay: they were scored for
  // that same profile and goals, and the refresh after the claim re-scores them. Deleting them
  // left a new account on an empty board ("hasn't looked yet") for the minute the refresh took,
  // right after sign-up (2026-11-03: a visitor saved their scout from "All picks", landed on an
  // empty board and left). Merged into an existing profile, the board is scored again from scratch.
  if (anonProfile && (!userProfile || userEmpty)) {
    const kept = await db
      .update(matches)
      .set({ userId, updatedAt: sql`now()` })
      .where(and(eq(matches.userId, anonId), sql`not exists (select 1 from matches m where m.user_id = ${userId} and m.opportunity_id = matches.opportunity_id)`))
      .returning({ id: matches.id });
    total += kept.length;
  }
  await db.delete(matches).where(eq(matches.userId, anonId));
  if (anonProfile && userProfile && userEmpty) {
    await db.batch([
      db.delete(profileVersions).where(eq(profileVersions.profileId, userProfile.id)),
      db.delete(facts).where(and(eq(facts.userId, userId), eq(facts.profileId, userProfile.id))),
      db.delete(profiles).where(eq(profiles.id, userProfile.id)),
    ]);
  }
  if (anonProfile && (!userProfile || userEmpty)) {
    // The draft simply becomes the person's profile.
    const rows = await db.batch([
      db.update(profiles).set({ userId, updatedAt: sql`now()` }).where(eq(profiles.id, anonProfile.id)).returning({ id: profiles.id }),
      db.update(facts).set({ userId, updatedAt: sql`now()` }).where(eq(facts.userId, anonId)).returning({ id: facts.id }),
    ]);
    total += rows.reduce((n, r) => n + r.length, 0);
  } else if (anonProfile && userProfile) {
    // Both exist: the person's confirmed choices win; documents decide the rest after a re-extraction.
    const keepRoles = !userProfile.roles.length && anonProfile.roles.length;
    const rows = await db.batch([
      db.update(facts).set({ userId, profileId: userProfile.id, updatedAt: sql`now()` }).where(eq(facts.userId, anonId)).returning({ id: facts.id }),
      db.delete(profileVersions).where(eq(profileVersions.profileId, anonProfile.id)).returning({ id: profileVersions.id }),
      db.delete(profiles).where(eq(profiles.id, anonProfile.id)).returning({ id: profiles.id }),
    ]);
    total += rows.reduce((n, r) => n + r.length, 0);
    if (keepRoles) {
      const draft = profileOf(anonProfile);
      await writeProfile(userId, (current) => ({ profile: { ...current, roles: draft.roles, industries: current.industries.length ? current.industries : draft.industries, functions: current.functions.length ? current.functions : draft.functions, occupations: current.occupations.length ? current.occupations : draft.occupations } }));
    }
    rebuild = true;
  }

  if (opts.email && total > 0) {
    const row = await getProfile(userId);
    if (row && !row.identity.email) {
      await recordConfirmedFacts(userId, row.id, [{ path: "/identity/email", value: opts.email, claim: opts.locale === "zh" ? `登录邮箱：${opts.email}` : `Email you signed in with: ${opts.email}` }]);
      await writeProfile(userId, (current) => (current.identity.email ? null : { profile: { ...current, identity: { ...current.identity, email: opts.email! } } }));
    }
  }
  // Both had content: rebuild from every source now that they are one person's.
  if (rebuild) await queueExtraction(userId, { locale: opts.locale, force: true });
  return { moved: total };
}

/**
 * Applications a visitor paid for signed out carry the email typed at checkout: when someone
 * signs in with that email, those drafts are theirs (the payment is the proof) and join the
 * account without a question. Returns how many rows moved.
 */
export async function claimPaidDrafts(email: string, userId: string, opts: { locale?: "en" | "zh" } = {}): Promise<{ moved: number; drafts: number }> {
  const { paidDraftOwners } = await import("@/lib/applications/unlock");
  const owners = (await paidDraftOwners(email)).filter((id) => isAnonId(id) && id !== userId);
  let moved = 0;
  for (const anonId of owners) {
    try {
      moved += (await claimAnonymousDraft(anonId, userId, { email, locale: opts.locale })).moved;
    } catch (err) {
      await captureError(err, { route: "profile/claimPaidDrafts", severity: "warn", context: { userId, anonId } });
    }
  }
  return { moved, drafts: owners.length };
}

/**
 * Removes anonymous drafts nobody claimed (older than `days`): rows and uploaded files.
 * For the maintenance cron (P6/integrator). Returns how many drafts were removed.
 */
export async function sweepAbandonedDrafts(days = 30, limit = 50): Promise<number> {
  const stale = await db
    .select({ userId: profiles.userId })
    .from(profiles)
    .where(and(sql`${profiles.userId} like 'anon\\_%'`, lt(profiles.updatedAt, sql`now() - make_interval(days => ${days})`)))
    .limit(limit);
  let removed = 0;
  for (const { userId } of stale) {
    try {
      const docs = await db.select({ objectKey: documents.objectKey }).from(documents).where(eq(documents.userId, userId));
      for (const d of docs) if (d.objectKey) await deleteObject(d.objectKey);
      const prof = await getProfile(userId);
      await db.batch([
        db.delete(facts).where(eq(facts.userId, userId)),
        db.delete(documents).where(eq(documents.userId, userId)),
        db.delete(milestones).where(eq(milestones.userId, userId)),
        db.delete(goals).where(eq(goals.userId, userId)),
        db.delete(events).where(eq(events.userId, userId)),
        db.delete(profileVersions).where(eq(profileVersions.profileId, prof?.id ?? "")),
        db.delete(profiles).where(eq(profiles.userId, userId)),
      ]);
      removed++;
    } catch (err) {
      await captureError(err, { route: "profile/sweepAbandonedDrafts", source: "cron", severity: "warn", context: { userId } });
    }
  }
  return removed;
}
