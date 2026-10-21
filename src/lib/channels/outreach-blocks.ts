import "server-only";
import { eq, sql } from "drizzle-orm";
import { keyedHash } from "@/lib/crypto";
import { db } from "@/lib/db";
import { contacts, outreachBlocks } from "@/lib/db/schema";

/*
 * The global "never write to this address again" list (outreach honesty rule 4). A recipient
 * who asks one Onward Scout user to stop is never emailed by any user again: every first email
 * and every follow-up checks this list (`checkOutreachPolicy` / `checkFollowUpPolicy` take the
 * answer as `blocked`). Addresses are stored only as keyed hashes.
 */

export function outreachHash(email: string): string {
  return keyedHash("outreach", email.trim().toLowerCase());
}

export async function isOutreachBlocked(email: string | null | undefined): Promise<boolean> {
  if (!email?.trim()) return false;
  const rows = await db.select({ h: outreachBlocks.emailHash }).from(outreachBlocks).where(eq(outreachBlocks.emailHash, outreachHash(email))).limit(1);
  return Boolean(rows[0]);
}

/** Blocks an address for everyone and marks every user's matching contact as do-not-contact. */
export async function blockOutreach(email: string, reason: "opt_out" | "admin"): Promise<void> {
  const addr = email.trim().toLowerCase();
  if (!addr) return;
  await db.insert(outreachBlocks).values({ emailHash: outreachHash(addr), reason }).onConflictDoNothing();
  await db.update(contacts).set({ doNotContact: true }).where(sql`lower(${contacts.email}) = ${addr}`);
}
