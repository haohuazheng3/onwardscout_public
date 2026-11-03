import "server-only";
import type Stripe from "stripe";
import { and, eq, isNull, sql } from "drizzle-orm";
import { reserveForApplication, settleApplication } from "@/lib/credits";
import { db } from "@/lib/db";
import { applications, type ApplicationRow } from "@/lib/db/schema";
import { captureError } from "@/lib/errors";
import { enqueueForDrain } from "@/lib/jobs/runner";
import { forgetUnlocked } from "@/lib/llm";
import { recordEvent } from "@/lib/notifications";
import { CREDIT_COST } from "@/content/plans";
import { appError, loadApplication, patchApplication } from "./engine";

/*
 * Unlocking (owner decision 2026-11-03). The preview of an application is free and drafted by the
 * local engine; paying for it — $19 once (signed in or not), or one credit of a season pass or an
 * older pack — unlocks it: `unlocked_at` is set, Claude writes every document in full (the
 * `application.upgrade` job), downloads and copy-ready answers open, and it can be confirmed.
 * Claude never runs for an application that is not unlocked (src/lib/llm/index.ts).
 *
 * Idempotent everywhere: the success page, the webhook and the reconcile cron may all report the
 * same payment; a credit unlock replayed finds the application already unlocked.
 */

export type UnlockSource = "order" | "credit" | "legacy";

/** Whether the application's full work is paid for (practice runs are always open). */
export function isUnlocked(app: Pick<ApplicationRow, "unlockedAt" | "practice">): boolean {
  return app.practice || Boolean(app.unlockedAt);
}

/** The row as the pure planners see it (plan.ts `AppState`): with its unlock spelled out. */
export function planState<T extends Pick<ApplicationRow, "unlockedAt" | "practice" | "unlockSource">>(app: T): T & { paid: boolean; unlockSource: "order" | "credit" | "legacy" | null } {
  return { ...app, paid: isUnlocked(app), unlockSource: app.unlockSource ?? null };
}

/** Starts (or re-arms) the Claude run for an unlocked application: profile read again, documents written in full. */
export async function startFullRun(app: Pick<ApplicationRow, "id" | "userId">): Promise<void> {
  // Runs in a drain (300 s), never inside the 60-second webhook or the page that settled the payment.
  await enqueueForDrain("application.upgrade", { applicationId: app.id }, { userId: app.userId, dedupeKey: `application.upgrade:${app.id}`, onDuplicate: "rearm" });
}

async function markUnlocked(app: ApplicationRow, source: UnlockSource, extra: { paidEmail?: string | null; orderId?: string | null } = {}): Promise<ApplicationRow> {
  // Conditional: the first writer wins; a replay sees the row already unlocked and changes nothing.
  const rows = await db
    .update(applications)
    .set({ unlockedAt: new Date(), unlockSource: source, ...(extra.paidEmail ? { paidEmail: extra.paidEmail.trim().toLowerCase() } : {}), updatedAt: sql`now()` })
    .where(and(eq(applications.id, app.id), isNull(applications.unlockedAt)))
    .returning();
  const next = rows[0];
  if (!next) return (await loadApplication(app.id)) ?? app;
  try {
    await recordEvent({ userId: app.userId, kind: "application.unlocked", applicationId: app.id, opportunityId: app.opportunityId, data: { source, orderId: extra.orderId ?? null } });
  } catch (err) {
    await captureError(err, { route: "applications/unlock (event)", severity: "warn" });
  }
  await startFullRun(next);
  return next;
}

/**
 * A single-application purchase confirmed by Stripe (billing.ts): the application opens and the
 * full run starts. The payer's email is kept so a later sign-in with it claims a signed-out draft.
 */
export async function unlockFromOrder(app: ApplicationRow, input: { orderId: string; email: string | null }): Promise<ApplicationRow> {
  if (isUnlocked(app)) return app;
  return markUnlocked(app, "order", { paidEmail: input.email, orderId: input.orderId });
}

/**
 * "Use 1 credit": a season pass covering this type, or an older pack, pays for the unlock. The
 * credit is reserved and spent at once (an unlock is delivered the moment it starts). Throws
 * ApplicationError("insufficient_credits", 402) when nothing can pay for it.
 */
export async function unlockWithCredit(userId: string, applicationId: string, opportunityType: string | null): Promise<ApplicationRow> {
  const app = await loadApplication(applicationId, userId);
  if (!app) throw appError("not_found", 404);
  if (isUnlocked(app)) return app;
  if (app.submittedAt) throw appError("already_submitted");
  const reserve = await reserveForApplication({ userId, applicationId: app.id, amount: CREDIT_COST.unlockApplication, opportunityType });
  if (!reserve.ok) throw appError("insufficient_credits", 402, { available: reserve.available, needed: reserve.needed, reason: reserve.reason });
  const settled = await settleApplication(app.id);
  if (settled.debited === 0) {
    // The reservation was already spent by an earlier unlock attempt that did not get to mark the row; still paid for.
    await captureError(new Error("unlock settled 0 credits after a successful reservation"), { route: "applications/unlock", severity: "warn", context: { applicationId: app.id } });
  }
  const withCredit = await patchApplication(app, { creditsReserved: 0 });
  return markUnlocked(withCredit, "credit");
}

/**
 * A refunded single purchase closes the application again (its documents stay, downloads and
 * Claude stop). Nothing happens to an application unlocked another way.
 */
export async function relockApplication(applicationId: string): Promise<boolean> {
  const rows = await db
    .update(applications)
    .set({ unlockedAt: null, unlockSource: null, updatedAt: sql`now()` })
    .where(and(eq(applications.id, applicationId), eq(applications.unlockSource, "order")))
    .returning({ id: applications.id, userId: applications.userId, opportunityId: applications.opportunityId });
  const row = rows[0];
  if (!row) return false;
  forgetUnlocked(applicationId);
  try {
    await recordEvent({ userId: row.userId, kind: "application.relocked", applicationId: row.id, opportunityId: row.opportunityId, data: { reason: "refunded" } });
  } catch (err) {
    await captureError(err, { route: "applications/relock (event)", severity: "warn" });
  }
  return true;
}

/** Applications a signed-out visitor paid for with this email (claimed when they sign in with it). */
/**
 * Whether a draft owner holds an application they paid for (and the email it was paid with):
 * such a draft is never deleted from the browser — it is theirs by that email.
 */
export async function paidApplicationOf(ownerId: string): Promise<{ email: string | null } | null> {
  const rows = await db
    .select({ email: applications.paidEmail })
    .from(applications)
    .where(and(eq(applications.userId, ownerId), eq(applications.unlockSource, "order")))
    .limit(1);
  return rows[0] ? { email: rows[0].email ?? null } : null;
}

export async function paidDraftOwners(email: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ userId: applications.userId })
    .from(applications)
    .where(and(eq(applications.paidEmail, email.trim().toLowerCase()), sql`${applications.userId} like 'anon\\_%'`));
  return rows.map((r) => r.userId);
}

/* ------------------------------------------------------------------ the checkout round trip */

export type UnlockSettlement = { state: "unlocked"; applicationId: string; email: string | null } | { state: "pending" } | { state: "not_ours" } | { state: "failed"; reason: string };

/**
 * Back from Stripe with `?session_id=`: the primary grant path for a single-application purchase
 * (the webhook and the daily reconcile are the fallbacks). Only the owner that started the
 * checkout (`client_reference_id`: a user id or an anonymous draft id) may settle it here.
 */
export async function settleUnlockSession(sessionId: string, ownerId: string): Promise<UnlockSettlement> {
  const { isCheckoutSessionId, grantFromCheckoutSession, validateSession } = await import("@/lib/billing");
  const { stripe, stripeEnvTag } = await import("@/lib/stripe");
  if (!isCheckoutSessionId(sessionId)) return { state: "failed", reason: "invalid-session-id" };
  let session: Stripe.Checkout.Session;
  try {
    session = await stripe().checkout.sessions.retrieve(sessionId, { expand: ["payment_intent.latest_charge"] });
  } catch (err) {
    await captureError(err, { route: "applications/unlock (settle)", context: { sessionId, ownerId } });
    return { state: "failed", reason: "stripe" };
  }
  if (session.client_reference_id !== ownerId) return { state: "not_ours" };
  if (session.status === "open" || session.payment_status === "unpaid") return { state: "pending" };
  const check = validateSession(session, stripeEnvTag());
  if (!check.ok || check.kind !== "single") return { state: "failed", reason: check.ok ? "not-single" : check.reason };
  const granted = await grantFromCheckoutSession(session, "success_page");
  if (!granted.ok) {
    await captureError(new Error(`unlock settle could not grant: ${granted.reason}`), { route: "applications/unlock (settle)", context: { sessionId, ownerId, reason: granted.reason } });
    return { state: "failed", reason: granted.reason };
  }
  return { state: "unlocked", applicationId: check.applicationId, email: session.customer_details?.email ?? session.customer_email ?? null };
}
