import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "./db";
import { orders, subscriptions, type OrderRow, type SubscriptionRow } from "./db/schema";
import { isPlanSku, NO_PLAN_PERKS, PLANS, type Offer, type PlanSku } from "@/content/plans";

/*
 * Read-only account views (billing page, success page, admin, plan perks for other features).
 * Writes to orders and subscriptions happen only in src/lib/billing.ts (success page, webhook,
 * reconcile).
 */

/** Stripe subscription statuses that keep the plan's perks and monthly credits. */
export const ENTITLED_STATUSES = ["active", "trialing", "past_due"] as const;

export function isEntitledStatus(status: string): boolean {
  return (ENTITLED_STATUSES as readonly string[]).includes(status);
}

export interface PlanView {
  /** The plan in force, or null for trial / pack-only accounts. */
  sku: PlanSku | null;
  perks: Offer["perks"];
  subscription: SubscriptionRow | null;
}

/** Pure: the plan whose perks apply, from the user's subscription rows (newest entitled one wins). */
export function pickActiveSubscription(rows: SubscriptionRow[]): SubscriptionRow | null {
  let best: SubscriptionRow | null = null;
  for (const r of rows) {
    if (!isPlanSku(r.sku) || !isEntitledStatus(r.status)) continue;
    if (!best || r.updatedAt.getTime() > best.updatedAt.getTime()) best = r;
  }
  return best;
}

export type PlanStatus = "active" | "cancelScheduled" | "pastDue" | "ended" | "none";

/** Pure: how the user's latest subscription reads on the billing page. */
export function planStatus(sub: Pick<SubscriptionRow, "status" | "cancelAtPeriodEnd" | "sku"> | null): PlanStatus {
  if (!sub || !isPlanSku(sub.sku)) return "none";
  if (!isEntitledStatus(sub.status)) return sub.status === "canceled" || sub.status === "unpaid" || sub.status === "incomplete_expired" ? "ended" : "none";
  if (sub.status === "past_due") return "pastDue";
  if (sub.cancelAtPeriodEnd) return "cancelScheduled";
  return "active";
}

/** The subscription whose perks apply right now, or null. */
export async function getActiveSubscription(userId: string): Promise<SubscriptionRow | null> {
  const rows = await db
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.userId, userId), inArray(subscriptions.status, [...ENTITLED_STATUSES])));
  return pickActiveSubscription(rows);
}

/**
 * The plan in force and its perks (automatic follow-ups, weekly brief, priority processing).
 * Other features read perks from here: `(await currentPlan(userId)).perks.weeklyDigest`.
 */
export async function currentPlan(userId: string): Promise<PlanView> {
  const subscription = await getActiveSubscription(userId);
  if (subscription && isPlanSku(subscription.sku)) {
    return { sku: subscription.sku, perks: PLANS[subscription.sku].perks, subscription };
  }
  return { sku: null, perks: NO_PLAN_PERKS, subscription: null };
}

/** The most recent subscription of any status (canceled included), for the billing page. */
export async function latestSubscription(userId: string): Promise<SubscriptionRow | null> {
  const rows = await db.select().from(subscriptions).where(eq(subscriptions.userId, userId)).orderBy(desc(subscriptions.updatedAt)).limit(1);
  return rows[0] ?? null;
}

/** Paid, refunded and disputed orders, newest first. */
export async function listOrders(userId: string, limit = 50): Promise<OrderRow[]> {
  return db.select().from(orders).where(eq(orders.userId, userId)).orderBy(desc(orders.createdAt)).limit(limit);
}

/** Who a recorded Checkout Session belongs to, or null when it has not been recorded yet. */
export async function orderOwner(stripeSessionId: string): Promise<string | null> {
  const rows = await db.select({ userId: orders.userId }).from(orders).where(eq(orders.stripeSessionId, stripeSessionId)).limit(1);
  return rows[0]?.userId ?? null;
}
