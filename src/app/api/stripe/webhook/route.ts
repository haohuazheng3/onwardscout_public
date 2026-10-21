import type Stripe from "stripe";
import { eq, sql } from "drizzle-orm";
import {
  benignGrantReason,
  grantFromCheckoutSession,
  grantFromInvoice,
  idOf,
  isOurs,
  noteFailedRenewal,
  reinstateByPaymentIntent,
  revokeByPaymentIntent,
  syncSubscription,
} from "@/lib/billing";
import { db } from "@/lib/db";
import { stripeEvents } from "@/lib/db/schema";
import { requireEnv } from "@/lib/env";
import { captureError } from "@/lib/errors";
import { notifyOwner } from "@/lib/notify";
import { stripe, stripeEnvTag } from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" } as const;

/*
 * Fallback grant path (the success page is the primary one), Pro renewals, subscription state,
 * refunds and disputes. Signature verified, idempotent on event.id through `stripe_events`.
 * Events for another site or environment are acknowledged (200) and marked "ignored"; a
 * processing failure answers 500 so Stripe retries with backoff (the success page and the daily
 * reconcile cover the gap meanwhile). Events handled = WEBHOOK_EVENTS in scripts/ops/stripe-offers.mjs.
 */

type Outcome = "processed" | "ignored";

function ours(metadata: Stripe.Metadata | null | undefined): boolean {
  return isOurs(metadata as Record<string, string> | null | undefined, stripeEnvTag());
}

async function handleSession(sessionId: string): Promise<Outcome> {
  const full = await stripe().checkout.sessions.retrieve(sessionId, {
    expand: ["subscription", "subscription.latest_invoice", "subscription.latest_invoice.payments", "payment_intent.latest_charge"],
  });
  const r = await grantFromCheckoutSession(full, "webhook");
  if (!r.ok) {
    if (benignGrantReason(r.reason)) return "ignored";
    throw new Error(`grant failed for ${sessionId}: ${r.reason}`);
  }
  return "processed";
}

async function handle(event: Stripe.Event): Promise<Outcome> {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const s = event.data.object;
      if (!ours(s.metadata)) return "ignored";
      return handleSession(s.id);
    }

    case "checkout.session.async_payment_failed": {
      const s = event.data.object;
      if (!ours(s.metadata)) return "ignored";
      await notifyOwner({
        subject: "Checkout payment failed to clear",
        text: `Checkout ${s.id} (${s.metadata?.sku ?? "?"}) for ${s.customer_details?.email ?? "unknown email"} failed after the session completed. Nothing was granted.`,
      });
      return "processed";
    }

    case "invoice.paid": {
      const invoice = event.data.object;
      const r = await grantFromInvoice(invoice, "webhook");
      if (!r.ok) {
        if (benignGrantReason(r.reason) || r.reason === "not-subscription") return "ignored";
        throw new Error(`invoice grant failed for ${invoice.id}: ${r.reason}`);
      }
      return "processed";
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object;
      const r = await noteFailedRenewal(invoice);
      if (!r.ok) return "ignored";
      await notifyOwner({
        subject: "Pro payment failed",
        text: `Invoice ${invoice.id} for ${invoice.customer_email ?? "unknown email"} failed. Stripe retries on its own schedule; the subscription is now "${r.status ?? "?"}".`,
      });
      return "processed";
    }

    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const snapshot = event.data.object;
      if (!ours(snapshot.metadata)) return "ignored";
      // Stripe does not order events: a delayed "updated" after "deleted" must not write a dead
      // subscription back as active, so the current object is fetched instead of the snapshot.
      const sub = await stripe().subscriptions.retrieve(snapshot.id);
      const r = await syncSubscription(sub);
      if (!r.ok) {
        if (r.reason === "other-site" || r.reason === "other-env") return "ignored";
        throw new Error(`subscription sync failed for ${sub.id}: ${r.reason}`);
      }
      return "processed";
    }

    case "charge.refunded": {
      const ch = event.data.object;
      const pi = idOf(ch.payment_intent as string | { id: string } | null);
      if (!pi) return "ignored";
      if (!ch.refunded) return "ignored"; // partial refund: credits stay
      const r = await revokeByPaymentIntent(pi, "refunded");
      return r ? "processed" : "ignored";
    }

    case "charge.dispute.created": {
      const d = event.data.object;
      const pi = idOf(d.payment_intent as string | { id: string } | null);
      if (!pi) return "ignored";
      const r = await revokeByPaymentIntent(pi, "disputed");
      if (r) {
        await notifyOwner({
          subject: "Dispute opened",
          text: `Dispute ${d.id} on ${pi} (${d.reason}, ${d.amount / 100} ${d.currency.toUpperCase()}). ${r.credits} unspent credits revoked for ${r.userId} while it is open.`,
        });
      }
      return r ? "processed" : "ignored";
    }

    case "charge.dispute.closed": {
      const d = event.data.object;
      const pi = idOf(d.payment_intent as string | { id: string } | null);
      if (!pi) return "ignored";
      // Won, or an inquiry that closed without becoming a chargeback: the buyer keeps what they paid for.
      if (d.status === "won" || d.status === "warning_closed") {
        const r = await reinstateByPaymentIntent(pi);
        await notifyOwner({
          subject: `Dispute closed: ${d.status}`,
          text: `Dispute ${d.id} on ${pi} closed with status "${d.status}". ${r ? `${r.credits} credits reinstated for ${r.userId}.` : "No matching order."}`,
        });
        return r ? "processed" : "ignored";
      }
      // Lost: the credits stay revoked.
      await notifyOwner({ subject: `Dispute closed: ${d.status}`, text: `Dispute ${d.id} on ${pi} closed with status "${d.status}". Credits remain revoked.` });
      return "processed";
    }

    default:
      return "ignored";
  }
}

export async function POST(req: Request) {
  const signature = req.headers.get("stripe-signature");
  if (!signature) return Response.json({ error: "Missing Stripe signature." }, { status: 400, headers: NO_STORE });
  const payload = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(payload, signature, requireEnv("STRIPE_WEBHOOK_SECRET"));
  } catch (err) {
    await captureError(err, { route: "/api/stripe/webhook", severity: "warn", context: { stage: "verify" } });
    return Response.json({ error: "Invalid Stripe signature." }, { status: 400, headers: NO_STORE });
  }

  try {
    const inserted = await db
      .insert(stripeEvents)
      .values({ id: event.id, type: event.type, status: "received" })
      .onConflictDoNothing()
      .returning({ id: stripeEvents.id });
    if (!inserted.length) {
      const prev = await db.select({ status: stripeEvents.status }).from(stripeEvents).where(eq(stripeEvents.id, event.id)).limit(1);
      if (prev[0] && (prev[0].status === "processed" || prev[0].status === "ignored")) {
        return Response.json({ received: true, duplicate: true }, { headers: NO_STORE });
      }
      // A previous attempt failed or crashed mid-way: processing again is safe, every write is idempotent.
    }

    const outcome = await handle(event);
    await db.update(stripeEvents).set({ status: outcome, processedAt: sql`now()`, error: null }).where(eq(stripeEvents.id, event.id));
    return Response.json({ received: true, outcome }, { headers: NO_STORE });
  } catch (err) {
    try {
      await db
        .update(stripeEvents)
        .set({ status: "failed", error: err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500) })
        .where(eq(stripeEvents.id, event.id));
    } catch (dbErr) {
      await captureError(dbErr, { route: "/api/stripe/webhook", severity: "warn", context: { stage: "mark-failed", eventId: event.id } });
    }
    await captureError(err, { route: "/api/stripe/webhook", context: { eventId: event.id, type: event.type } });
    // 500 makes Stripe retry with backoff; the success page and the reconcile cron cover the gap meanwhile.
    return Response.json({ error: "Processing failed; Stripe will retry." }, { status: 500, headers: NO_STORE });
  }
}
