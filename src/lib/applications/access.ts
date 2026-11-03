import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { applications, generatedDocuments } from "@/lib/db/schema";
import { isUnlocked } from "./unlock";

/** True when a generated document belongs to an application that is still the free preview (no file leaves). */
export async function documentLocked(userId: string, generatedDocumentId: string): Promise<boolean> {
  const rows = await db
    .select({ applicationId: generatedDocuments.applicationId })
    .from(generatedDocuments)
    .where(and(eq(generatedDocuments.id, generatedDocumentId), eq(generatedDocuments.userId, userId)))
    .limit(1);
  const applicationId = rows[0]?.applicationId;
  // A document outside any application (an older profile draft) is the person's own to download.
  if (!applicationId) return false;
  const app = (await db.select({ unlockedAt: applications.unlockedAt, practice: applications.practice }).from(applications).where(eq(applications.id, applicationId)).limit(1))[0];
  return app ? !isUnlocked(app) : false;
}
