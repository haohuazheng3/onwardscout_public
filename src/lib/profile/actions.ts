import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { readProfile } from "@/lib/llm/types";
import { db } from "@/lib/db";
import { facts, profileVersions, type FactRow } from "@/lib/db/schema";
import { listGoals } from "./goals";
import { gapsFor, GapAnswerError, type GapQuestion } from "./gaps";
import { resolveIndexPath, setAt, stableStringify, valueAt } from "./merge";
import { applyProfilePatch, PatchError, type ProfilePatch } from "./patch";
import { fixClaim, fixTarget, parseFix } from "./sections";
import { ensureProfile, getFacts, profileOf, recordConfirmedFacts, writeProfile } from "./store";
import { identityLabel, isIdentityCode } from "@/lib/core/identities";

/*
 * Server actions behind the profile routes, shared by the signed-in (/api/profile…) and the
 * signed-out (/api/drafts/profile) handlers. Each one: compare-and-set write of the profile,
 * then the confirmed facts that make the change stick.
 */

export class ActionError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "ActionError";
  }
}

export interface ProfileSummary {
  version: number;
  status: string;
  completeness: number;
  gaps: GapQuestion[];
}

/** Why each identity was pre-selected: the `/roles/<code>` facts from the last extraction. */
export function roleHintsOf(rows: readonly Pick<FactRow, "path" | "claim" | "confidence">[]): Record<string, { why: string; confidence: number }> {
  const out: Record<string, { why: string; confidence: number }> = {};
  for (const f of rows) {
    if (!f.path.startsWith("/roles/")) continue;
    const code = f.path.slice("/roles/".length);
    if (isIdentityCode(code)) out[code] = { why: f.claim, confidence: f.confidence };
  }
  return out;
}

/** Answered gap paths = the person's confirmed fact paths. */
export function answeredPaths(rows: readonly Pick<FactRow, "path" | "confirmedByUser">[]): string[] {
  return rows.filter((f) => f.confirmedByUser).map((f) => f.path);
}

/** The questions still open for an owner (goals considered), at most `limit`. */
export async function openGaps(ownerId: string, limit = 3): Promise<GapQuestion[]> {
  const [row, rows, goalRows] = await Promise.all([ensureProfile(ownerId), getFacts(ownerId), listGoals(ownerId, { onlyActive: true }).catch(() => [])]);
  return gapsFor(
    profileOf(row),
    goalRows.map((g) => ({ family: g.family, sub: g.sub })),
    { answeredPaths: answeredPaths(rows), limit },
  );
}

/** One tap on the profile card. */
export async function patchProfile(ownerId: string, patch: ProfilePatch, locale: "en" | "zh"): Promise<ProfileSummary> {
  let saved;
  try {
    // The confirmed facts go first: an extraction that runs between the two writes then
    // already treats the paths as the person's (and restores their values from the facts).
    const before = await ensureProfile(ownerId);
    const pre = applyProfilePatch(profileOf(before), patch, { locale });
    await recordConfirmedFacts(ownerId, before.id, pre.facts);
    saved = await writeProfile(ownerId, (current, row) => {
      const r = applyProfilePatch(current, patch, { locale });
      if (r.confirm) return { profile: current, status: "confirmed", bump: true };
      // A tap on a profile still being built keeps "parsing"; otherwise it is a draft until confirmed.
      return { profile: r.profile, status: row.status === "empty" ? "draft" : row.status };
    });
  } catch (err) {
    if (err instanceof PatchError || err instanceof GapAnswerError) throw new ActionError(err.message);
    throw err;
  }
  const gaps = await openGaps(ownerId);
  return { version: saved.version, status: saved.status, completeness: saved.completeness, gaps };
}

/** "Confirm": the person agrees with a sourced fact. */
export async function confirmFact(ownerId: string, factId: string, locale: "en" | "zh"): Promise<FactRow> {
  const fact = (await db.select().from(facts).where(and(eq(facts.id, factId), eq(facts.userId, ownerId))).limit(1))[0];
  if (!fact) throw new ActionError("We couldn't find that fact.", 404);
  const roleCode = fact.path.startsWith("/roles/") ? fact.path.split("/")[2] : null;
  if (roleCode && isIdentityCode(roleCode)) {
    // Confirming an identity guess = picking that identity.
    const current = profileOf(await ensureProfile(ownerId));
    const roles = current.roles.some((r) => r.code === roleCode)
      ? current.roles.map((r) => (r.code === roleCode ? { ...r, inferred: false } : r))
      : [...current.roles, { code: roleCode, stage: (fact.value as { stage?: string | null } | null)?.stage ?? null, since: null, inferred: false }];
    await patchProfile(ownerId, { op: "roles", roles: roles.map((r) => ({ code: r.code, stage: r.stage })) }, locale);
    return { ...fact, claim: locale === "zh" ? `你的身份：${identityLabel(roleCode, locale)}` : `You are: ${identityLabel(roleCode, locale)}` };
  }
  // The profile shows exactly what the person confirmed.
  let path = fact.path;
  const saved = await writeProfile(ownerId, (current) => {
    path = resolveIndexPath(current, fact.path, fact.value);
    const at = valueAt(current, path);
    if (at === undefined || stableStringify(at) === stableStringify(fact.value)) return null;
    try {
      return { profile: setAt(current, path, fact.value) };
    } catch {
      return null;
    }
  });
  const rows = await db
    .update(facts)
    .set({ path, confirmedByUser: true, profileId: saved.id, updatedAt: sql`now()` })
    .where(and(eq(facts.id, factId), eq(facts.userId, ownerId)))
    .returning();
  return rows[0]!;
}

/** "Fix it": the person corrects a value inline; the fact becomes their word. */
export async function fixFact(ownerId: string, factId: string, raw: unknown, locale: "en" | "zh"): Promise<FactRow> {
  const fact = (await db.select().from(facts).where(and(eq(facts.id, factId), eq(facts.userId, ownerId))).limit(1))[0];
  if (!fact) throw new ActionError("We couldn't find that fact.", 404);
  const target = fixTarget(fact.path);
  if (!target) throw new ActionError("That value can't be edited here.");
  const fix = parseFix(target, raw);
  if (fix === null) throw new ActionError("That change doesn't look right. Check the fields and try again.");
  let next: unknown = fix;
  let path = fact.path;
  const saved = await writeProfile(ownerId, (current) => {
    path = resolveIndexPath(current, fact.path, fact.value);
    const at = valueAt(current, path);
    next = target.shape === "item" ? { ...((at ?? fact.value ?? {}) as Record<string, unknown>), ...(fix as Record<string, unknown>) } : fix || null;
    try {
      const p = readProfile(setAt(current, path, next));
      return { profile: p };
    } catch {
      throw new ActionError("That part of your profile changed meanwhile. Reload and try again.", 409);
    }
  });
  const rows = await db
    .update(facts)
    .set({ path, value: (next ?? null) as FactRow["value"], claim: fixClaim(target, next, locale).slice(0, 500), confirmedByUser: true, profileId: saved.id, updatedAt: sql`now()` })
    .where(and(eq(facts.id, factId), eq(facts.userId, ownerId)))
    .returning();
  return rows[0]!;
}

/** Brings back an earlier version as the newest one. */
export async function restoreVersion(ownerId: string, version: number): Promise<{ version: number }> {
  const row = await ensureProfile(ownerId);
  const snap = (await db.select().from(profileVersions).where(and(eq(profileVersions.profileId, row.id), eq(profileVersions.version, version))).limit(1))[0];
  if (!snap) throw new ActionError("We couldn't find that version.", 404);
  const saved = await writeProfile(ownerId, () => ({ profile: readProfile(snap.snapshot), status: "draft", bump: true }));
  return { version: saved.version };
}
