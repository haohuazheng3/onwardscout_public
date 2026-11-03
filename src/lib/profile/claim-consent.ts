import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { getProfile } from "./store";

/*
 * Whether a draft found in this browser may simply become the signed-in person's.
 *
 * A new account (no profile, or one nobody filled) takes the draft as it is: that is the visitor
 * who just signed up. An account that already has a profile only takes it with a yes — the draft
 * may be someone else's on a shared computer (2026-11-02: a test draft was merged into the
 * owner's real profile when the owner signed in on the same browser), and claiming re-reads
 * every document into one profile, so the merge is not something to do silently.
 */

export interface PendingDraft {
  /** The name the draft's documents gave, if any. */
  name: string | null;
  /** Its files, as uploaded (up to five). */
  files: string[];
}

/** True for a profile row that holds nothing the person read, chose or confirmed. */
export function profileIsBlank(p: { status: string; completeness: number; roles: unknown[] } | null): boolean {
  return !p || (p.status === "empty" && p.completeness === 0 && p.roles.length === 0);
}

/** The draft to ask about, or null when it can be claimed without asking. */
export async function draftNeedsConsent(anonId: string, userId: string): Promise<PendingDraft | null> {
  const [mine, draft] = await Promise.all([getProfile(userId), getProfile(anonId)]);
  if (profileIsBlank(mine)) return null;
  const files = await db.select({ filename: documents.filename }).from(documents).where(eq(documents.userId, anonId)).limit(5);
  if (profileIsBlank(draft) && !files.length) return null;
  return { name: draft?.identity?.name?.trim() || null, files: files.map((f) => f.filename).filter((f): f is string => Boolean(f)) };
}
