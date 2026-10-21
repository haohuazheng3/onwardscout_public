import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { db } from "@/lib/db";
import { integrations } from "@/lib/db/schema";
import { newId } from "@/lib/ids";

/*
 * The `integrations` row for Google (one per user). The refresh token is stored only
 * encrypted (AES-256-GCM, INTEGRATION_KEY, bound to the user id as AAD) and is never sent to
 * a browser, logged or exported in plain text.
 */

export interface GoogleIntegration {
  id: string;
  status: "active" | "revoked" | "error";
  accountEmail: string | null;
  scopes: string[];
  hasToken: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export async function getGoogleIntegration(userId: string): Promise<GoogleIntegration | null> {
  const rows = await db
    .select({
      id: integrations.id,
      status: integrations.status,
      accountEmail: integrations.accountEmail,
      scopes: integrations.scopes,
      token: integrations.refreshTokenEnc,
      createdAt: integrations.createdAt,
      updatedAt: integrations.updatedAt,
    })
    .from(integrations)
    .where(and(eq(integrations.userId, userId), eq(integrations.provider, "google")))
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  return { id: r.id, status: r.status, accountEmail: r.accountEmail, scopes: r.scopes, hasToken: Boolean(r.token), createdAt: r.createdAt, updatedAt: r.updatedAt };
}

export async function saveGoogleIntegration(input: { userId: string; refreshToken: string; email: string; scopes: string[] }): Promise<void> {
  const enc = encryptSecret(input.refreshToken, input.userId);
  await db
    .insert(integrations)
    .values({ id: newId("int"), userId: input.userId, provider: "google", scopes: input.scopes, refreshTokenEnc: enc, accountEmail: input.email, status: "active" })
    .onConflictDoUpdate({
      target: [integrations.userId, integrations.provider],
      set: { scopes: input.scopes, refreshTokenEnc: enc, accountEmail: input.email, status: "active", updatedAt: sql`now()` },
    });
}

/** The decrypted refresh token of an active connection, or null. */
export async function googleRefreshToken(userId: string): Promise<{ token: string; email: string | null } | null> {
  const rows = await db
    .select({ token: integrations.refreshTokenEnc, email: integrations.accountEmail, status: integrations.status })
    .from(integrations)
    .where(and(eq(integrations.userId, userId), eq(integrations.provider, "google")))
    .limit(1);
  const r = rows[0];
  if (!r || r.status !== "active" || !r.token) return null;
  return { token: decryptSecret(r.token, userId), email: r.email };
}

/** Google said the grant is gone (revoked in the Google account, password change…). */
export async function markGoogleError(userId: string): Promise<void> {
  await db
    .update(integrations)
    .set({ status: "error", updatedAt: sql`now()` })
    .where(and(eq(integrations.userId, userId), eq(integrations.provider, "google"), eq(integrations.status, "active")));
}

/** Disconnect: the token is erased, the row stays as a record that access was revoked. */
export async function clearGoogleIntegration(userId: string): Promise<void> {
  await db
    .update(integrations)
    .set({ status: "revoked", refreshTokenEnc: null, updatedAt: sql`now()` })
    .where(and(eq(integrations.userId, userId), eq(integrations.provider, "google")));
}
