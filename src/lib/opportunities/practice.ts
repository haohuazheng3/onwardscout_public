import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { opportunities, type OpportunityRow } from "@/lib/db/schema";
import { newId } from "@/lib/ids";
import { practiceOpportunity } from "@/lib/sources/practice";

/*
 * The built-in practice application (the "Sandbox" of the build contract): a real end-to-end run against our
 * own /sandbox/form, never a real organisation, free (no credits). Every person sees it pinned
 * on top of the Scout board until they have made their first application.
 *
 * The row itself is defined once, by the sources layer (src/lib/sources/practice.ts, written by
 * the seed runner); when a fresh database hasn't been seeded yet, the first request inserts that
 * same definition (idempotent on the slug; the seed later fills in its source).
 */

export const PRACTICE_OPPORTUNITY_SLUG = "practice-application";

let cached: OpportunityRow | null = null;

/** The practice opportunity row, created on first use when the seed hasn't run yet. */
export async function ensurePracticeOpportunity(): Promise<OpportunityRow> {
  if (cached) return cached;
  const existing = await db.select().from(opportunities).where(eq(opportunities.slug, PRACTICE_OPPORTUNITY_SLUG)).limit(1);
  if (existing[0]) return (cached = existing[0]);
  const { draft } = practiceOpportunity(new Date());
  await db
    .insert(opportunities)
    .values({ ...draft, id: newId("opp"), slug: PRACTICE_OPPORTUNITY_SLUG, sourceId: null })
    .onConflictDoNothing({ target: opportunities.slug });
  const rows = await db.select().from(opportunities).where(eq(opportunities.slug, PRACTICE_OPPORTUNITY_SLUG)).limit(1);
  if (!rows[0]) throw new Error("The practice opportunity could not be created");
  return (cached = rows[0]);
}

/** Why the practice run is on top, in the person's language (stored as the match's reasons). */
export function practiceReasons(locale: string): string[] {
  return locale === "zh"
    ? ["完整看一遍 Onward Scout 会替你准备和提交什么", "提交到我们自己的沙盒表单，不会发给任何真实机构", "免费：练习申请不消耗额度"]
    : [
        "See exactly what Onward Scout prepares and submits, start to finish",
        "Goes to our own sandbox form — nothing reaches a real organisation",
        "Free: practice runs never use credits",
      ];
}

