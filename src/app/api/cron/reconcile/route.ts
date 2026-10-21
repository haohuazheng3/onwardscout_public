import { bearerMatches } from "@/lib/admin";
import { CRON_RECONCILE_STATE_KEY, needsAttention, reconcile, RECONCILE_STATE_KEY, saveAppState } from "@/lib/billing";
import { env } from "@/lib/env";
import { captureError } from "@/lib/errors";
import { notifyOwner } from "@/lib/notify";
import { stripeMode } from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const NO_STORE = { "Cache-Control": "no-store" } as const;

/** Named so the error inbox groups every run under one entry (fingerprint = name + frame + route). */
class StripePermissionSkipped extends Error {
  constructor(skipped: { step: string; reason: string }[]) {
    super(`Reconcile skipped ${skipped.map((s) => `${s.step}: Stripe key lacks ${s.reason}`).join("; ")}`);
    this.name = "StripePermissionSkipped";
  }
}

/**
 * Daily (Vercel Cron, GET + Bearer CRON_SECRET) or on demand (POST, same auth): what Stripe says
 * was paid over the last `?days=` (default 7, max 90) against what the database granted, with
 * repairs. Steps the organization key may not read are skipped, not failed. The full report is
 * kept in app_state for the admin diagnostics page.
 */
async function run(req: Request): Promise<Response> {
  if (!bearerMatches(req, env("CRON_SECRET"))) return Response.json({ error: "Unauthorized." }, { status: 401, headers: NO_STORE });
  if (stripeMode() === "missing") {
    return Response.json({ ok: true, skipped: "Stripe is not configured on this deployment." }, { headers: NO_STORE });
  }
  const days = Math.min(90, Math.max(1, Number(new URL(req.url).searchParams.get("days") ?? 7) || 7));
  const startedAt = Date.now();
  try {
    const report = await reconcile(days);
    const failed = [...report.sessions.failed, ...report.invoices.failed, ...report.subscriptions.failed];
    const repaired = [...report.sessions.repaired, ...report.invoices.repaired];
    await saveAppState(RECONCILE_STATE_KEY, report);
    await saveAppState(CRON_RECONCILE_STATE_KEY, {
      ranAt: report.ranAt,
      tookMs: Date.now() - startedAt,
      days,
      checked: report.sessions.scanned + report.invoices.scanned + report.subscriptions.scanned,
      repaired,
      failed,
      refundsApplied: report.refundsApplied,
      skipped: report.skipped,
    });
    if (report.skipped.length) {
      // A step Stripe refused for a missing key permission: one warning per run (grouped in the
      // inbox, never an email, never a red /api/health); the fix is on the key, not in the code.
      await captureError(new StripePermissionSkipped(report.skipped), {
        route: "/api/cron/reconcile",
        source: "cron",
        severity: "warn",
        context: { skipped: report.skipped, days },
      });
    }
    if (needsAttention(report)) {
      await notifyOwner({ subject: "Reconcile found differences", text: JSON.stringify(report, null, 2).slice(0, 20_000) });
    }
    return Response.json(report, { status: failed.length ? 409 : 200, headers: NO_STORE });
  } catch (err) {
    await captureError(err, { route: "/api/cron/reconcile", source: "cron" });
    try {
      await saveAppState(CRON_RECONCILE_STATE_KEY, {
        ranAt: new Date(startedAt).toISOString(),
        tookMs: Date.now() - startedAt,
        days,
        error: err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500),
      });
    } catch (stateErr) {
      await captureError(stateErr, { route: "/api/cron/reconcile", source: "cron", severity: "warn" });
    }
    return Response.json({ error: "Reconcile failed; see the error inbox." }, { status: 500, headers: NO_STORE });
  }
}

export const GET = run;
export const POST = run;
