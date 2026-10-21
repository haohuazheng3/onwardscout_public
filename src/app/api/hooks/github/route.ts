import { waitUntil } from "@vercel/functions";
import { env } from "@/lib/env";
import { captureError, withErrorCapture } from "@/lib/errors";
import { decideFallback, signatureMatches } from "@/lib/deploy-fallback";
import { notifyOwner } from "@/lib/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/hooks/github";
const NO_STORE = { "Cache-Control": "no-store" } as const;

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

/**
 * GitHub repository webhook (event `workflow_run`, secret GITHUB_WEBHOOK_SECRET). When the
 * Deploy workflow on main ends without deploying (failure, startup_failure, timed_out — the
 * Actions quota being exhausted looks like an immediate failure), POST the Vercel Deploy Hook
 * so Vercel builds the commit itself. Everything else is acknowledged and ignored.
 *
 *  200 pong / ignored · 202 fallback triggered · 401 bad signature · 400 bad body
 *  502 Deploy Hook refused · 503 GITHUB_WEBHOOK_SECRET or VERCEL_DEPLOY_HOOK_URL missing
 */
async function handle(req: Request): Promise<Response> {
  const secret = env("GITHUB_WEBHOOK_SECRET");
  if (!secret) return json({ error: "GITHUB_WEBHOOK_SECRET is not configured" }, 503);

  const raw = await req.text();
  if (!signatureMatches(raw, req.headers.get("x-hub-signature-256"), secret)) return json({ error: "bad signature" }, 401);

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return json({ error: "body is not JSON" }, 400);
  }

  const delivery = req.headers.get("x-github-delivery") ?? undefined;
  const decision = decideFallback(req.headers.get("x-github-event"), payload);
  if (decision.kind === "pong") return json({ ok: true, pong: true, delivery });
  if (decision.kind === "ignore") return json({ ok: true, ignored: decision.why, delivery });

  const hookUrl = env("VERCEL_DEPLOY_HOOK_URL");
  if (!hookUrl) {
    await captureError(new Error(`Deploy workflow ended in ${decision.conclusion} but VERCEL_DEPLOY_HOOK_URL is not configured`), {
      route: ROUTE,
      source: "server",
      context: { sha: decision.sha, runUrl: decision.runUrl },
    });
    return json({ error: "VERCEL_DEPLOY_HOOK_URL is not configured" }, 503);
  }

  const res = await fetch(hookUrl, { method: "POST", signal: AbortSignal.timeout(15_000) });
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    await captureError(new Error(`Vercel Deploy Hook answered ${res.status}: ${text.slice(0, 200)}`), {
      route: ROUTE,
      source: "server",
      context: { sha: decision.sha, runUrl: decision.runUrl, conclusion: decision.conclusion },
    });
    return json({ error: "deploy hook refused", status: res.status }, 502);
  }

  let jobId: string | undefined;
  try {
    const parsed = JSON.parse(text) as { job?: { id?: unknown } };
    if (typeof parsed.job?.id === "string") jobId = parsed.job.id;
  } catch {
    // The hook answered 2xx; its body is informational only.
  }

  // The owner should know the Actions path is down (quota, outage), without the request waiting on mail.
  const notice = notifyOwner({
    subject: `Deploy fallback: Vercel is building ${decision.sha.slice(0, 7) || "main"} (Actions run ${decision.conclusion})`,
    text: [
      `The Deploy workflow on main ended in "${decision.conclusion}", so the Vercel Deploy Hook was triggered and Vercel is building the commit itself.`,
      "",
      `Commit: ${decision.sha || "-"}`,
      `Run: ${decision.runUrl || "-"}`,
      `Vercel job: ${jobId ?? "-"}`,
      "",
      "If this is the monthly Actions quota, nothing to do: the fallback keeps deploying until it resets.",
      "If the workflow itself is broken, fix it: every push now costs Vercel build minutes.",
    ].join("\n"),
  });
  try {
    waitUntil(notice);
  } catch {
    await notice;
  }
  return json({ ok: true, triggered: true, conclusion: decision.conclusion, sha: decision.sha, job: jobId, delivery }, 202);
}

export const POST = withErrorCapture(ROUTE, handle);
