import "server-only";
import type Stripe from "stripe";
import { and, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import { db } from "./db";
import { appState, creditLots, orders, subscriptions, users, type OrderRow, type SubscriptionRow } from "./db/schema";
import type { OrderStatus } from "./core/types";
import { env } from "./env";
import { captureError } from "./errors";
import { grantLot, lotExpiryFor, restoreLot, revokeLot } from "./credits";
import { newId } from "./ids";
import { CHECKOUT_BRAND, stripe, stripeContext, stripeEnvTag, stripePermissionProblem } from "./stripe";
import { isPlanSku, isSku, OFFERS, SKUS, type Locale, type PlanSku, type Sku } from "@/content/plans";

/*
 * The ONLY module that turns Stripe objects into orders, subscriptions and credit lots. Three
 * callers feed it the same objects: the success page (primary, immediate), the webhook
 * (fallback, retried by Stripe) and the daily reconcile cron (repairs). Everything here is
 * idempotent, so any of them may run first, twice, or at the same time:
 *
 *  - orders are unique per Checkout Session id;
 *  - subscriptions are unique per Stripe subscription id;
 *  - credit lots are unique per source key: the session id for a pack, and
 *    `<subscriptionId>:<periodStartUnix>` for every paid Pro invoice;
 *  - a refunded or disputed order is never re-granted by a late event.
 */

export type GrantSource = "success_page" | "webhook" | "reconcile";

export interface UnixPeriod {
  start: number;
  end: number;
}

export type SessionCheck = { ok: true; userId: string; sku: Sku; kind: "pack" | "subscription" } | { ok: false; reason: string };

export type InvoiceCheck =
  | { ok: true; subscriptionId: string; userId: string | null; sku: PlanSku | null; period: UnixPeriod; billingReason: string }
  | { ok: false; reason: string };

export type GrantResult =
  | {
      ok: true;
      userId: string;
      sku: Sku;
      kind: "pack" | "subscription";
      orderId: string | null;
      /** Credits in the lot this purchase (or this invoice period) created. */
      credits: number;
      /** True when this call created the lot; false when an earlier caller already had. */
      lotCreated: boolean;
      sourceKey: string;
      expiresAt: Date;
      /** Cents. */
      amountTotal: number;
      currency: string;
    }
  | { ok: false; reason: string };

/* ------------------------------------------------------------------ pure helpers (unit-tested) */

export function idOf(v: string | { id: string } | null | undefined): string | null {
  if (!v) return null;
  return typeof v === "string" ? v : v.id;
}

/** Stripe price id → sku, from the STRIPE_PRICE_* variables. Unknown prices map to nothing. */
export function priceMap(read: (name: string) => string | undefined = env): Record<string, Sku> {
  const map: Record<string, Sku> = {};
  for (const sku of SKUS) {
    const id = read(OFFERS[sku].priceEnv);
    if (id) map[id] = sku;
  }
  return map;
}

export function skuForPriceId(priceId: string | null | undefined, map: Record<string, Sku> = priceMap()): Sku | null {
  if (!priceId) return null;
  return map[priceId] ?? null;
}

/** Credit lot key for one paid period of a subscription: the same invoice always yields the same key. */
export function subscriptionLotKey(subscriptionId: string, periodStartUnix: number): string {
  return `${subscriptionId}:${periodStartUnix}`;
}

/** Credit lot key for a one-time pack: the Checkout Session id. */
export function packLotKey(sessionId: string): string {
  return sessionId;
}

/** The current billing period of a subscription (kept on its items since API 2025-03-31). */
export function subscriptionPeriod(sub: Pick<Stripe.Subscription, "items">): UnixPeriod | null {
  let best: UnixPeriod | null = null;
  for (const item of sub.items?.data ?? []) {
    if (typeof item.current_period_start !== "number" || typeof item.current_period_end !== "number") continue;
    if (!best || item.current_period_end > best.end) best = { start: item.current_period_start, end: item.current_period_end };
  }
  return best;
}

type LineLike = Pick<Stripe.InvoiceLineItem, "parent" | "subscription">;
type PeriodLine = LineLike & Pick<Stripe.InvoiceLineItem, "period">;

function isSubscriptionLine(line: LineLike): boolean {
  if (line.parent?.type === "subscription_item_details") return true;
  return Boolean(line.subscription);
}

/**
 * The service period an invoice pays for: its regular subscription line (prorations skipped),
 * falling back to the invoice's own period. Lot keys are built from `start`.
 */
export function invoicePeriod(invoice: Pick<Stripe.Invoice, "lines" | "period_start" | "period_end">): UnixPeriod {
  const lines = (invoice.lines?.data ?? []) as PeriodLine[];
  const subscriptionLines = lines.filter(isSubscriptionLine);
  const regular = subscriptionLines.filter((l) => !(l.parent?.subscription_item_details?.proration ?? false));
  const pool = regular.length ? regular : subscriptionLines;
  let best: UnixPeriod | null = null;
  for (const l of pool) {
    if (!l.period) continue;
    if (!best || l.period.end > best.end) best = { start: l.period.start, end: l.period.end };
  }
  return best ?? { start: invoice.period_start, end: invoice.period_end };
}

export function invoiceSubscriptionId(invoice: Pick<Stripe.Invoice, "parent">): string | null {
  const details = invoice.parent?.subscription_details;
  if (!details) return null;
  return idOf(details.subscription as string | { id: string } | null);
}

/** Metadata we stamped through `subscription_data.metadata` (snapshotted onto every invoice). */
export function invoiceMetadata(invoice: Pick<Stripe.Invoice, "parent" | "metadata">): Record<string, string> {
  return (invoice.parent?.subscription_details?.metadata ?? invoice.metadata ?? {}) as Record<string, string>;
}

/** The plan an invoice bills: from the subscription line's price, else from the snapshotted metadata. */
export function invoiceSku(invoice: Pick<Stripe.Invoice, "lines" | "parent" | "metadata">, map: Record<string, Sku> = priceMap()): PlanSku | null {
  const lines = (invoice.lines?.data ?? []) as (LineLike & Pick<Stripe.InvoiceLineItem, "pricing">)[];
  for (const l of lines) {
    if (!isSubscriptionLine(l)) continue;
    const price = l.pricing?.price_details?.price;
    const sku = skuForPriceId(idOf(price as string | { id: string } | null | undefined), map);
    if (sku && isPlanSku(sku)) return sku;
  }
  const meta = invoiceMetadata(invoice).sku;
  return isPlanSku(meta) ? meta : null;
}

/** The plan a subscription is on: from its item's price, else from its metadata. */
export function subscriptionSku(sub: Pick<Stripe.Subscription, "items" | "metadata">, map: Record<string, Sku> = priceMap()): PlanSku | null {
  for (const item of sub.items?.data ?? []) {
    const sku = skuForPriceId(idOf(item.price as string | { id: string } | null | undefined), map);
    if (sku && isPlanSku(sku)) return sku;
  }
  const meta = sub.metadata?.sku;
  return isPlanSku(meta) ? meta : null;
}

/** Pure: does this metadata belong to an Onward Scout object from this environment? (missing env tag = production) */
export function isOurs(metadata: Record<string, string> | null | undefined, envTag: string): boolean {
  return metadata?.site === CHECKOUT_BRAND.site && (metadata?.env ?? "production") === envTag;
}

/** Pure: is this Checkout Session a completed Onward Scout purchase from this environment, and for whom? */
export function validateSession(
  s: Pick<Stripe.Checkout.Session, "metadata" | "mode" | "status" | "payment_status" | "client_reference_id">,
  envTag: string,
): SessionCheck {
  if (s.metadata?.site !== CHECKOUT_BRAND.site) return { ok: false, reason: "other-site" };
  if ((s.metadata?.env ?? "production") !== envTag) return { ok: false, reason: "other-env" };
  if (s.mode !== "payment" && s.mode !== "subscription") return { ok: false, reason: `mode-${s.mode}` };
  if (s.status !== "complete") return { ok: false, reason: `status-${s.status}` };
  if (s.payment_status !== "paid" && s.payment_status !== "no_payment_required") return { ok: false, reason: `payment-${s.payment_status}` };
  const userId = s.client_reference_id ?? s.metadata?.userId ?? null;
  if (!userId) return { ok: false, reason: "no-user" };
  if (s.metadata?.userId && s.metadata.userId !== userId) return { ok: false, reason: "user-mismatch" };
  const sku = s.metadata?.sku;
  if (!isSku(sku)) return { ok: false, reason: "unknown-sku" };
  const kind = isPlanSku(sku) ? "subscription" : "pack";
  if (kind === "subscription" && s.mode !== "subscription") return { ok: false, reason: "plan-not-subscription-mode" };
  if (kind === "pack" && s.mode !== "payment") return { ok: false, reason: "pack-not-payment-mode" };
  return { ok: true, userId, sku, kind };
}

/**
 * Invoices that pay for a whole plan period and therefore carry a full lot of credits. A plan
 * change produces a proration invoice that pays for nothing new, so it grants nothing; the next
 * `subscription_cycle` invoice grants the new period's credits.
 */
export const GRANTING_BILLING_REASONS: readonly string[] = ["subscription_create", "subscription_cycle"];

/** Pure: is this a paid Onward Scout subscription invoice from this environment that pays for a period? */
export function validateInvoice(
  invoice: Pick<Stripe.Invoice, "status" | "billing_reason" | "parent" | "metadata" | "lines" | "period_start" | "period_end">,
  envTag: string,
  map: Record<string, Sku> = priceMap(),
): InvoiceCheck {
  const subscriptionId = invoiceSubscriptionId(invoice);
  if (!subscriptionId) return { ok: false, reason: "not-subscription" };
  const meta = invoiceMetadata(invoice);
  if (meta.site !== CHECKOUT_BRAND.site) return { ok: false, reason: "other-site" };
  if ((meta.env ?? "production") !== envTag) return { ok: false, reason: "other-env" };
  if (invoice.status !== "paid") return { ok: false, reason: `status-${invoice.status}` };
  const reason = invoice.billing_reason ?? "unknown";
  if (!GRANTING_BILLING_REASONS.includes(reason)) return { ok: false, reason: `billing-${reason}` };
  return { ok: true, subscriptionId, userId: meta.userId ?? null, sku: invoiceSku(invoice, map), period: invoicePeriod(invoice), billingReason: reason };
}

/**
 * Grant refusals that mean "nothing to do" rather than "something is wrong": another site or
 * environment, an order already refunded or disputed, a payment still clearing, an invoice that
 * does not pay for a period. Shared by the webhook (answer 200, mark ignored) and reconcile
 * (not a failure). Prefixes added by callers (`invoice-`, `subscription-`) are stripped first.
 */
export function benignGrantReason(reason: string): boolean {
  const bare = reason.replace(/^(invoice-|subscription-)+/, "");
  return bare === "other-site" || bare === "other-env" || bare.startsWith("order-") || bare.startsWith("payment-") || bare.startsWith("billing-");
}

/** Pure: the short reference people quote to support for a Checkout Session ("…" + last 8 characters). */
export function checkoutRef(sessionId: string): string {
  return sessionId.replace(/[^A-Za-z0-9]/g, "").slice(-8).toUpperCase();
}

/** Pure: a Checkout Session id as Stripe issues them (the success page refuses anything else). */
export function isCheckoutSessionId(v: unknown): v is string {
  return typeof v === "string" && /^cs_(live|test)_[A-Za-z0-9]{10,200}$/.test(v);
}

/* ------------------------------------------------------------------ user notifications */

type Translate = (key: string, values?: Record<string, string | number | Date>) => string;

async function userLocale(userId: string): Promise<Locale> {
  const rows = await db.select({ locale: users.locale }).from(users).where(eq(users.id, userId)).limit(1);
  return rows[0]?.locale === "zh" ? "zh" : "en";
}

/**
 * Tells the person what happened to their credits (in-app, and by email when it needs action).
 * Never throws: a notification problem must not fail a grant, a refund or a webhook.
 */
async function tellUser(
  userId: string,
  build: (t: Translate, locale: Locale) => { title: string; body: string },
  opts: { email?: boolean; href?: string } = {},
): Promise<void> {
  try {
    const [{ createTranslator }, { loadMessages }, { notify }] = await Promise.all([
      import("next-intl"),
      import("@/i18n/messages"),
      import("@/lib/notifications"),
    ]);
    const locale = await userLocale(userId);
    const messages = await loadMessages(locale, ["billing"]);
    const t = createTranslator({ locale, messages, namespace: "billing.notifications", timeZone: "UTC" }) as unknown as Translate;
    const { title, body } = build(t, locale);
    await notify({ userId, kind: "billing", title, body, href: opts.href ?? "/app/billing", email: opts.email ?? false });
  } catch (err) {
    await captureError(err, { route: "billing:notify", severity: "warn", context: { userId } });
  }
}

/* ------------------------------------------------------------------ lookups */

async function orderBySession(sessionId: string): Promise<OrderRow | null> {
  const rows = await db.select().from(orders).where(eq(orders.stripeSessionId, sessionId)).limit(1);
  return rows[0] ?? null;
}

async function orderByPaymentIntent(pi: string): Promise<OrderRow | null> {
  const rows = await db.select().from(orders).where(eq(orders.stripePaymentIntent, pi)).limit(1);
  return rows[0] ?? null;
}

async function orderBySubscription(subscriptionId: string): Promise<OrderRow | null> {
  const rows = await db.select().from(orders).where(eq(orders.stripeSubscriptionId, subscriptionId)).orderBy(desc(orders.createdAt)).limit(1);
  return rows[0] ?? null;
}

async function subscriptionRow(subscriptionId: string): Promise<SubscriptionRow | null> {
  const rows = await db.select().from(subscriptions).where(eq(subscriptions.stripeSubscriptionId, subscriptionId)).limit(1);
  return rows[0] ?? null;
}

async function userIdByCustomer(customerId: string | null): Promise<string | null> {
  if (!customerId) return null;
  const rows = await db.select({ id: users.id }).from(users).where(eq(users.stripeCustomerId, customerId)).limit(1);
  return rows[0]?.id ?? null;
}

async function userExists(userId: string): Promise<boolean> {
  const rows = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
  return rows.length > 0;
}

/** The money behind a payment was refunded in full, or is (or was) disputed. */
export function chargeReversed(charge: Pick<Stripe.Charge, "refunded" | "amount" | "amount_refunded" | "disputed"> | null | undefined): "refunded" | "disputed" | null {
  if (!charge) return null;
  if (charge.refunded || (charge.amount > 0 && charge.amount_refunded >= charge.amount)) return "refunded";
  if (charge.disputed) return "disputed";
  return null;
}

/** The latest charge of a payment intent (expanded object or fetched), null when unknown. */
async function latestCharge(pi: string | Stripe.PaymentIntent | null | undefined): Promise<Stripe.Charge | null> {
  if (!pi) return null;
  const intent = typeof pi === "string" ? await stripe().paymentIntents.retrieve(pi, { expand: ["latest_charge"] }) : pi;
  const charge = intent.latest_charge;
  if (charge && typeof charge !== "string") return charge;
  if (typeof charge === "string") return stripe().charges.retrieve(charge);
  return null;
}

async function lotExists(sourceKey: string): Promise<boolean> {
  const rows = await db.select({ id: creditLots.id }).from(creditLots).where(eq(creditLots.sourceKey, sourceKey)).limit(1);
  return rows.length > 0;
}

/* ------------------------------------------------------------------ subscriptions */

/**
 * Mirrors a Stripe subscription into `subscriptions` (status, period, cancel flag). Used by
 * `customer.subscription.updated|deleted`, by the checkout grant and by reconcile. A canceled
 * subscription keeps its credit lots: they expire on their own schedule.
 */
export async function syncSubscription(
  sub: Stripe.Subscription,
  known: { userId?: string | null; sku?: PlanSku | null } = {},
): Promise<{ ok: true; row: SubscriptionRow; userId: string; sku: PlanSku } | { ok: false; reason: string }> {
  const meta = (sub.metadata ?? {}) as Record<string, string>;
  if (meta.site !== CHECKOUT_BRAND.site) return { ok: false, reason: "other-site" };
  if ((meta.env ?? "production") !== stripeEnvTag()) return { ok: false, reason: "other-env" };

  const existing = await subscriptionRow(sub.id);
  const userId = known.userId ?? meta.userId ?? existing?.userId ?? (await userIdByCustomer(idOf(sub.customer as string | { id: string } | null)));
  if (!userId) return { ok: false, reason: "no-user" };
  if (existing && existing.userId !== userId) return { ok: false, reason: "user-mismatch" };
  // A deleted account is never recreated from Stripe metadata (its users row is gone).
  if (!(await userExists(userId))) return { ok: false, reason: "no-user" };

  const sku = known.sku ?? subscriptionSku(sub) ?? (existing && isPlanSku(existing.sku) ? existing.sku : null);
  if (!sku) return { ok: false, reason: "unknown-plan" };

  const period = subscriptionPeriod(sub);
  const values = {
    userId,
    sku,
    status: sub.status,
    currentPeriodStart: period ? new Date(period.start * 1000) : null,
    currentPeriodEnd: period ? new Date(period.end * 1000) : null,
    cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
  };
  const rows = await db
    .insert(subscriptions)
    .values({ id: newId("sub"), stripeSubscriptionId: sub.id, ...values })
    .onConflictDoUpdate({ target: subscriptions.stripeSubscriptionId, set: { ...values, updatedAt: sql`now()` } })
    .returning();
  const row = rows[0];
  if (!row) return { ok: false, reason: "subscription-not-persisted" };
  return { ok: true, row, userId, sku };
}

/* ------------------------------------------------------------------ grants */

/**
 * `invoice.paid`: one credit lot per paid period, keyed `<subscriptionId>:<periodStart>`.
 * Called for the first invoice (through the checkout grant) and for every renewal.
 */
export async function grantFromInvoice(invoice: Stripe.Invoice, source: GrantSource): Promise<GrantResult> {
  const check = validateInvoice(invoice, stripeEnvTag());
  if (!check.ok) return check;

  let row = await subscriptionRow(check.subscriptionId);
  if (!row) {
    // The subscription event has not reached us yet (or was missed): mirror it now so perks apply.
    const sub = await stripe().subscriptions.retrieve(check.subscriptionId);
    const synced = await syncSubscription(sub, { userId: check.userId, sku: check.sku });
    if (!synced.ok) return { ok: false, reason: `subscription-${synced.reason}` };
    row = synced.row;
  }
  const userId = check.userId ?? row.userId;
  if (userId !== row.userId) return { ok: false, reason: "user-mismatch" };
  if (!(await userExists(userId))) return { ok: false, reason: "unknown-user" };
  const sku = check.sku ?? (isPlanSku(row.sku) ? row.sku : null);
  if (!sku) return { ok: false, reason: "unknown-plan" };

  const order = await orderBySubscription(check.subscriptionId);
  if (order && order.status !== "paid" && order.stripeInvoiceId === invoice.id) return { ok: false, reason: `order-${order.status}` };

  const sourceKey = subscriptionLotKey(check.subscriptionId, check.period.start);
  // Before a period's lot is created: money already refunded or disputed buys nothing (a refund
  // event that arrived before the grant found no lot to revoke, and renewals have no order row).
  if (!(await lotExists(sourceKey))) {
    const pi = invoicePaymentIntentId(invoice);
    const reversed = pi ? chargeReversed(await latestCharge(pi)) : null;
    if (reversed) return { ok: false, reason: `charge-${reversed}` };
  }
  const expiresAt = lotExpiryFor(sku, { periodEnd: new Date(check.period.end * 1000) });
  const credits = OFFERS[sku].credits;
  const { created } = await grantLot({ userId, kind: "subscription", total: credits, sourceKey, expiresAt, orderId: order?.id ?? null });
  if (created) {
    console.info(`[billing] ${source}: ${credits} ${sku} credits for ${userId} (${sourceKey})`);
    if (source !== "success_page") {
      const renewal = check.billingReason === "subscription_cycle";
      await tellUser(userId, (t) => ({
        title: t(renewal ? "renewedTitle" : "planStartedTitle", { count: credits }),
        body: t(renewal ? "renewedBody" : "planStartedBody", { count: credits, date: expiresAt }),
      }));
    }
  }
  return {
    ok: true,
    userId,
    sku,
    kind: "subscription",
    orderId: order?.id ?? null,
    credits,
    lotCreated: created,
    sourceKey,
    expiresAt,
    amountTotal: invoice.amount_paid,
    currency: invoice.currency,
  };
}

function invoicePaymentIntentId(invoice: Stripe.Invoice): string | null {
  for (const p of invoice.payments?.data ?? []) {
    const id = idOf(p.payment?.payment_intent as string | { id: string } | null | undefined);
    if (id) return id;
  }
  return null;
}

/**
 * The purchase behind a completed Checkout Session. Packs: one order + one lot (180 days) keyed
 * by the session id. Pro: the order, the mirrored subscription and the first period's lot
 * (through `grantFromInvoice` on the invoice the session created, so the webhook's
 * `invoice.paid` for the same period lands on the same key).
 *
 * Pass the session with `subscription`, `subscription.latest_invoice` and
 * `payment_intent.latest_charge` expanded; anything missing is fetched.
 */
export async function grantFromCheckoutSession(s: Stripe.Checkout.Session, source: GrantSource): Promise<GrantResult> {
  const check = validateSession(s, stripeEnvTag());
  if (!check.ok) return check;
  const { userId, sku, kind } = check;
  if (!(await userExists(userId))) return { ok: false, reason: "unknown-user" };

  const promo = s.discounts?.[0]?.promotion_code;
  const promoCode = promo && typeof promo !== "string" ? promo.code : idOf(promo as string | null | undefined);
  const email = s.customer_details?.email ?? s.customer_email ?? null;
  const piId = idOf(s.payment_intent as string | { id: string } | null);
  const subscriptionId = idOf(s.subscription as string | { id: string } | null);

  await db
    .insert(orders)
    .values({
      id: newId("ord"),
      userId,
      kind,
      sku,
      stripeSessionId: s.id,
      stripeSubscriptionId: subscriptionId,
      stripePaymentIntent: piId,
      stripeInvoiceId: idOf(s.invoice as string | { id: string } | null),
      amountTotal: s.amount_total ?? 0,
      currency: s.currency ?? "usd",
      status: "paid",
      promoCode,
      email,
      source,
    })
    .onConflictDoNothing({ target: orders.stripeSessionId });
  const order = await orderBySession(s.id);
  if (!order) return { ok: false, reason: "order-not-persisted" };
  if (order.userId !== userId) return { ok: false, reason: "user-mismatch" };
  // A refunded or disputed order is never re-granted by a late or replayed event.
  if (order.status !== "paid") return { ok: false, reason: `order-${order.status}` };

  if (kind === "pack") {
    const sourceKey = packLotKey(s.id);
    if (!(await lotExists(sourceKey))) {
      // The session was fetched with payment_intent.latest_charge expanded: no extra call here.
      const pi = s.payment_intent && typeof s.payment_intent !== "string" ? s.payment_intent : piId;
      const reversed = chargeReversed(await latestCharge(pi));
      if (reversed) {
        await setOrderStatus(order.id, reversed);
        return { ok: false, reason: `charge-${reversed}` };
      }
    }
    const expiresAt = lotExpiryFor(sku, { purchasedAt: new Date(s.created * 1000) });
    const credits = OFFERS[sku].credits;
    const { created } = await grantLot({ userId, kind: "pack", total: credits, sourceKey, expiresAt, orderId: order.id });
    if (created) {
      console.info(`[billing] ${source}: ${credits}-credit pack for ${userId} (${s.id})`);
      if (source !== "success_page") {
        await tellUser(userId, (t) => ({ title: t("packTitle", { count: credits }), body: t("packBody", { count: credits, date: expiresAt }) }));
      }
    }
    return { ok: true, userId, sku, kind, orderId: order.id, credits, lotCreated: created, sourceKey, expiresAt, amountTotal: order.amountTotal, currency: order.currency };
  }

  if (!subscriptionId) return { ok: false, reason: "no-subscription" };
  const sub =
    s.subscription && typeof s.subscription !== "string"
      ? s.subscription
      : await stripe().subscriptions.retrieve(subscriptionId, { expand: ["latest_invoice", "latest_invoice.payments"] });
  const synced = await syncSubscription(sub, { userId, sku: isPlanSku(sku) ? sku : null });
  if (!synced.ok) return { ok: false, reason: `subscription-${synced.reason}` };

  const sessionInvoiceId = idOf(s.invoice as string | { id: string } | null);
  const latestInvoiceId = idOf(sub.latest_invoice as string | { id: string } | null);
  const invoiceId = sessionInvoiceId ?? latestInvoiceId;
  if (!invoiceId) return { ok: false, reason: "no-invoice" };
  const expandedLatest = sub.latest_invoice && typeof sub.latest_invoice !== "string" ? sub.latest_invoice : null;
  const invoice =
    s.invoice && typeof s.invoice !== "string"
      ? s.invoice
      : expandedLatest && expandedLatest.id === invoiceId
        ? expandedLatest
        : await stripe().invoices.retrieve(invoiceId, { expand: ["payments"] });

  const patch: Partial<typeof orders.$inferInsert> = {};
  if (!order.stripeSubscriptionId) patch.stripeSubscriptionId = subscriptionId;
  if (!order.stripeInvoiceId) patch.stripeInvoiceId = invoice.id;
  if (!order.stripePaymentIntent) {
    const pi = invoicePaymentIntentId(invoice);
    if (pi) patch.stripePaymentIntent = pi;
  }
  if (Object.keys(patch).length) await db.update(orders).set({ ...patch, updatedAt: sql`now()` }).where(eq(orders.id, order.id));

  const granted = await grantFromInvoice(invoice, source);
  if (!granted.ok) return { ok: false, reason: `invoice-${granted.reason}` };
  return { ...granted, orderId: order.id, amountTotal: order.amountTotal, currency: order.currency };
}

/* ------------------------------------------------------------------ refunds and disputes */

export interface RevokeOutcome {
  userId: string;
  /** Lot keys touched (a pack's session id, or a subscription period key). */
  sourceKeys: string[];
  /** Credits taken away (revoke) or given back (reinstate). */
  credits: number;
}

/** The invoice a payment intent paid, through Stripe's invoice payments index (charges no longer link to invoices). */
async function invoiceForPaymentIntent(pi: string): Promise<Stripe.Invoice | null> {
  const page = await stripe().invoicePayments.list({ payment: { type: "payment_intent", payment_intent: pi }, limit: 1, expand: ["data.invoice"] });
  const inv = page.data[0]?.invoice;
  if (!inv) return null;
  if (typeof inv === "string") return stripe().invoices.retrieve(inv);
  return "deleted" in inv && inv.deleted ? null : (inv as Stripe.Invoice);
}

/** What a payment intent bought: which order (if any) and which lot it funded. */
async function locateByPaymentIntent(pi: string): Promise<{ userId: string; order: OrderRow | null; sourceKey: string } | null> {
  const order = await orderByPaymentIntent(pi);
  if (order?.kind === "pack") return { userId: order.userId, order, sourceKey: packLotKey(order.stripeSessionId) };

  const invoice = await invoiceForPaymentIntent(pi);
  if (!invoice) return order ? { userId: order.userId, order, sourceKey: "" } : null;
  const subscriptionId = invoiceSubscriptionId(invoice);
  if (!subscriptionId) return null;
  if (invoiceMetadata(invoice).site !== CHECKOUT_BRAND.site) return null;
  const sourceKey = subscriptionLotKey(subscriptionId, invoicePeriod(invoice).start);
  const owner = order ?? (await orderBySubscription(subscriptionId));
  const userId = owner?.userId ?? invoiceMetadata(invoice).userId ?? (await subscriptionRow(subscriptionId))?.userId ?? null;
  if (!userId) return null;
  // Only the order this very invoice created changes status; renewals have no order row.
  const sameInvoice = owner && owner.stripeInvoiceId === invoice.id ? owner : null;
  return { userId, order: sameInvoice, sourceKey };
}

async function setOrderStatus(orderId: string, status: OrderStatus): Promise<void> {
  await db.update(orders).set({ status, updatedAt: sql`now()` }).where(eq(orders.id, orderId));
}

/**
 * Full refund or open dispute on a payment: the unspent credits it bought are gone and the order
 * is marked. Applications already holding credits keep their reservation. Null when the payment
 * is not ours.
 */
export async function revokeByPaymentIntent(pi: string, reason: "refunded" | "disputed"): Promise<RevokeOutcome | null> {
  const hit = await locateByPaymentIntent(pi);
  if (!hit) return null;
  // A refund always wins; a dispute only marks a paid order (never turns "refunded" back into "disputed").
  if (hit.order && (reason === "refunded" ? hit.order.status !== "refunded" : hit.order.status === "paid")) await setOrderStatus(hit.order.id, reason);
  let credits = 0;
  const sourceKeys: string[] = [];
  if (hit.sourceKey) {
    const r = await revokeLot(hit.sourceKey);
    if (r) {
      credits += r.revoked;
      sourceKeys.push(hit.sourceKey);
    }
  }
  if (sourceKeys.length) {
    await tellUser(
      hit.userId,
      (t) => ({ title: t(reason === "refunded" ? "refundedTitle" : "disputedTitle"), body: t(reason === "refunded" ? "refundedBody" : "disputedBody", { count: credits }) }),
      { email: true },
    );
  }
  return { userId: hit.userId, sourceKeys, credits };
}

/** Dispute closed in our favour: the order is paid again and whatever the ledger says is unspent comes back. */
export async function reinstateByPaymentIntent(pi: string): Promise<RevokeOutcome | null> {
  const hit = await locateByPaymentIntent(pi);
  if (!hit) return null;
  // Won a dispute over a payment that was refunded anyway: the money is gone, so are the credits.
  const charge = await latestCharge(pi);
  if (chargeReversed(charge ? { ...charge, disputed: false } : null) === "refunded") return { userId: hit.userId, sourceKeys: [], credits: 0 };
  if (hit.order && hit.order.status === "disputed") await setOrderStatus(hit.order.id, "paid");
  let credits = 0;
  const sourceKeys: string[] = [];
  if (hit.sourceKey) {
    const r = await restoreLot(hit.sourceKey);
    if (r) {
      credits += r.restored;
      sourceKeys.push(hit.sourceKey);
    }
  }
  if (sourceKeys.length) {
    await tellUser(hit.userId, (t) => ({ title: t("reinstatedTitle"), body: t("reinstatedBody", { count: credits }) }));
  }
  return { userId: hit.userId, sourceKeys, credits };
}

/** A Pro renewal failed: mirror the new status and tell the person (Stripe retries on its own schedule). */
export async function noteFailedRenewal(invoice: Stripe.Invoice): Promise<{ ok: boolean; status?: string }> {
  const subscriptionId = invoiceSubscriptionId(invoice);
  if (!subscriptionId || !isOurs(invoiceMetadata(invoice), stripeEnvTag())) return { ok: false };
  const sub = await stripe().subscriptions.retrieve(subscriptionId);
  const synced = await syncSubscription(sub);
  if (synced.ok) {
    await tellUser(synced.userId, (t) => ({ title: t("paymentFailedTitle"), body: t("paymentFailedBody") }), { email: true });
  }
  return { ok: synced.ok, status: sub.status };
}

/* ------------------------------------------------------------------ customers */

/** True unless Stripe says this customer id does not exist on the account we talk to (or was deleted). */
async function customerUsable(customerId: string): Promise<boolean> {
  try {
    const c = await stripe().customers.retrieve(customerId);
    return !("deleted" in c && c.deleted);
  } catch (err) {
    const e = err as { code?: string; statusCode?: number };
    if (e.code === "resource_missing" || e.statusCode === 404) return false;
    throw err;
  }
}

/**
 * One Stripe customer per user, remembered on the users row. The stored id is checked against the
 * account we currently talk to: when the project moves from the interim account to the dedicated
 * Onward Scout account (STRIPE_CONTEXT changes) every old id is unknown there, and a fresh customer
 * is created instead of every checkout failing with "No such customer". Idempotent per user and account.
 */
export async function ensureStripeCustomer(user: { id: string; email: string; stripeCustomerId: string | null }): Promise<string> {
  if (user.stripeCustomerId && (await customerUsable(user.stripeCustomerId))) return user.stripeCustomerId;
  const account = stripeContext() ?? "direct";
  const customer = await stripe().customers.create(
    { email: user.email, metadata: { site: CHECKOUT_BRAND.site, userId: user.id } },
    { idempotencyKey: `os-customer-${user.id}-${account}` },
  );
  if (user.stripeCustomerId) {
    await db.update(users).set({ stripeCustomerId: customer.id }).where(and(eq(users.id, user.id), eq(users.stripeCustomerId, user.stripeCustomerId)));
    return customer.id;
  }
  // Two concurrent checkouts both create (Stripe returns the same customer for the same key); keep the first stored id.
  await db.update(users).set({ stripeCustomerId: customer.id }).where(and(eq(users.id, user.id), sql`${users.stripeCustomerId} is null`));
  const rows = await db.select({ id: users.stripeCustomerId }).from(users).where(eq(users.id, user.id)).limit(1);
  return rows[0]?.id ?? customer.id;
}

/* ------------------------------------------------------------------ reconcile */

/** app_state keys the reconcile cron writes and the admin pages read. */
export const RECONCILE_STATE_KEY = "reconcile:last";
export const CRON_RECONCILE_STATE_KEY = "cron:reconcile:last";

export type ReconcileStep = "sessions" | "invoices" | "subscriptions" | "refunds";

export interface ReconcileReport {
  ranAt: string;
  days: number;
  sessions: {
    scanned: number;
    ours: number;
    alreadyGranted: number;
    repaired: { sessionId: string; userId: string; sku: string; credits: number }[];
    failed: { sessionId: string; reason: string }[];
  };
  invoices: {
    scanned: number;
    ours: number;
    alreadyGranted: number;
    repaired: { invoiceId: string; userId: string; sku: string; credits: number; sourceKey: string }[];
    failed: { invoiceId: string; reason: string }[];
  };
  subscriptions: { scanned: number; ours: number; synced: number; failed: { subscriptionId: string; reason: string }[] };
  /** Order ids whose payment Stripe shows as fully refunded while we still had them as paid. */
  refundsApplied: string[];
  /**
   * Steps Stripe refused for lack of a key permission (an organization key without "Invoices
   * Read", say). The step is skipped, the others still run, and the run is not a failure.
   */
  skipped: { step: ReconcileStep; reason: string }[];
}

export function emptyReport(days: number, now: Date = new Date()): ReconcileReport {
  return {
    ranAt: now.toISOString(),
    days,
    sessions: { scanned: 0, ours: 0, alreadyGranted: 0, repaired: [], failed: [] },
    invoices: { scanned: 0, ours: 0, alreadyGranted: 0, repaired: [], failed: [] },
    subscriptions: { scanned: 0, ours: 0, synced: 0, failed: [] },
    refundsApplied: [],
    skipped: [],
  };
}

/** Records a permission-denied step once per run (the same reason would repeat per item otherwise). */
export function noteSkipped(report: ReconcileReport, step: ReconcileStep, reason: string): void {
  if (!report.skipped.some((s) => s.step === step && s.reason === reason)) report.skipped.push({ step, reason });
}

/**
 * Runs one reconcile step. A Stripe permission error records the step as skipped and lets the
 * next step run; any other error is a real failure and aborts the run.
 */
export async function runReconcileStep(report: ReconcileReport, step: ReconcileStep, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    const denied = stripePermissionProblem(err);
    if (!denied) throw err;
    noteSkipped(report, step, denied);
  }
}

function short(err: unknown): string {
  return err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200);
}

/**
 * Compares what Stripe says was paid in the last `days` with what the database granted, and
 * repairs the difference: sessions and invoices without their credit lot, subscription mirrors
 * that drifted, and full refunds we never heard about. Every step is idempotent.
 */
export async function reconcile(days = 7): Promise<ReconcileReport> {
  const s = stripe();
  const since = Math.floor(Date.now() / 1000) - days * 86400;
  const envTag = stripeEnvTag();
  const report = emptyReport(days);

  // 1. Completed Checkout Sessions → orders + (pack lot | subscription mirror + first-period lot).
  await runReconcileStep(report, "sessions", async () => {
    for await (const session of s.checkout.sessions.list({ created: { gte: since }, status: "complete", limit: 100 })) {
      report.sessions.scanned++;
      if (!validateSession(session, envTag).ok) continue;
      report.sessions.ours++;
      try {
        const full = await s.checkout.sessions.retrieve(session.id, {
          expand: ["subscription", "subscription.latest_invoice", "subscription.latest_invoice.payments", "payment_intent.latest_charge"],
        });
        const r = await grantFromCheckoutSession(full, "reconcile");
        if (!r.ok) {
          if (!benignGrantReason(r.reason)) report.sessions.failed.push({ sessionId: session.id, reason: r.reason });
          continue;
        }
        if (r.lotCreated) report.sessions.repaired.push({ sessionId: session.id, userId: r.userId, sku: r.sku, credits: r.credits });
        else report.sessions.alreadyGranted++;
      } catch (err) {
        const denied = stripePermissionProblem(err);
        if (denied) noteSkipped(report, "sessions", denied);
        else report.sessions.failed.push({ sessionId: session.id, reason: short(err) });
      }
    }
  });

  // 2. Paid invoices → one lot per Pro period (renewals never pass through a session).
  await runReconcileStep(report, "invoices", async () => {
    for await (const invoice of s.invoices.list({ created: { gte: since }, status: "paid", limit: 100 })) {
      report.invoices.scanned++;
      if (!validateInvoice(invoice, envTag).ok) continue;
      report.invoices.ours++;
      try {
        const r = await grantFromInvoice(invoice, "reconcile");
        if (!r.ok) {
          if (!benignGrantReason(r.reason)) report.invoices.failed.push({ invoiceId: invoice.id, reason: r.reason });
          continue;
        }
        if (r.lotCreated) report.invoices.repaired.push({ invoiceId: invoice.id, userId: r.userId, sku: r.sku, credits: r.credits, sourceKey: r.sourceKey });
        else report.invoices.alreadyGranted++;
      } catch (err) {
        const denied = stripePermissionProblem(err);
        if (denied) noteSkipped(report, "invoices", denied);
        else report.invoices.failed.push({ invoiceId: invoice.id, reason: short(err) });
      }
    }
  });

  // 3. Subscription mirrors: status, period and cancel flag as Stripe has them now.
  await runReconcileStep(report, "subscriptions", async () => {
    for await (const sub of s.subscriptions.list({ status: "all", limit: 100 })) {
      report.subscriptions.scanned++;
      if (!isOurs(sub.metadata as Record<string, string>, envTag)) continue;
      report.subscriptions.ours++;
      try {
        const r = await syncSubscription(sub);
        if (r.ok) report.subscriptions.synced++;
        else report.subscriptions.failed.push({ subscriptionId: sub.id, reason: r.reason });
      } catch (err) {
        const denied = stripePermissionProblem(err);
        if (denied) noteSkipped(report, "subscriptions", denied);
        else report.subscriptions.failed.push({ subscriptionId: sub.id, reason: short(err) });
      }
    }
  });

  // 4. Refunds Stripe knows about that we missed (a webhook outage): paid orders of the last 90 days.
  await runReconcileStep(report, "refunds", async () => {
    const recent = await db
      .select()
      .from(orders)
      .where(and(eq(orders.status, "paid"), isNotNull(orders.stripePaymentIntent), gte(orders.createdAt, new Date(Date.now() - 90 * 86400 * 1000))));
    for (const o of recent) {
      if (!o.stripePaymentIntent) continue;
      let pi: Stripe.PaymentIntent | null = null;
      try {
        pi = await s.paymentIntents.retrieve(o.stripePaymentIntent, { expand: ["latest_charge"] });
      } catch (err) {
        const denied = stripePermissionProblem(err);
        if (denied) noteSkipped(report, "refunds", denied);
        else report.sessions.failed.push({ sessionId: o.stripeSessionId, reason: `payment-intent: ${short(err)}` });
        continue;
      }
      const charge = pi.latest_charge && typeof pi.latest_charge !== "string" ? pi.latest_charge : null;
      if (charge?.refunded) {
        await revokeByPaymentIntent(o.stripePaymentIntent, "refunded");
        report.refundsApplied.push(o.id);
      }
    }
  });

  return report;
}

/**
 * True when the report shows anything the owner should look at. Skipped steps are not in here: a
 * missing key permission is a standing condition (a warning in the error inbox), not a daily email.
 */
export function needsAttention(r: ReconcileReport): boolean {
  return (
    r.sessions.repaired.length > 0 ||
    r.sessions.failed.length > 0 ||
    r.invoices.repaired.length > 0 ||
    r.invoices.failed.length > 0 ||
    r.subscriptions.failed.length > 0 ||
    r.refundsApplied.length > 0
  );
}

/** Upserts one app_state entry (the reconcile report and the cron's run summary). */
export async function saveAppState(key: string, value: unknown): Promise<void> {
  await db
    .insert(appState)
    .values({ key, value })
    .onConflictDoUpdate({ target: appState.key, set: { value, updatedAt: sql`now()` } });
}
