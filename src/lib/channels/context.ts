import "server-only";
import { isMinor, type IdentityCode } from "@/lib/core";
import type { PersonContext } from "./types";

/*
 * What the person's profile says, for channels that map fields (CH3) or write to people (CH4):
 * the profile row, the sourced facts in the shape the intelligence layer takes, and whether the
 * person is a minor (no outreach channel). Read through P1's profile module (contracts §8).
 */

export type { PersonContext };

export async function loadPersonContext(userId: string): Promise<PersonContext> {
  const { getProfile, getFacts } = await import("@/lib/profile");
  const [profile, facts] = await Promise.all([getProfile(userId), getFacts(userId)]);
  const roles = (profile?.roles ?? []) as { code?: string }[];
  const codes = roles.map((r) => r.code).filter((c): c is IdentityCode => typeof c === "string");
  const identity = (profile?.identity ?? null) as { name?: string | null; languages?: { code?: string }[] } | null;
  const zh = (identity?.languages ?? []).some((l) => l.code === "zh") && !(identity?.languages ?? []).some((l) => l.code === "en");
  return {
    profile,
    facts: facts.map((f) => ({
      id: f.id,
      path: f.path,
      claim: f.claim,
      value: f.value,
      quote: f.quote,
      sourceDocId: f.sourceDocId,
      confidence: f.confidence,
      confirmedByUser: f.confirmedByUser,
    })),
    name: identity?.name?.trim() || null,
    isMinor: isMinor(codes),
    language: zh ? "zh" : "en",
  };
}
