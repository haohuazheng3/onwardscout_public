import { createHmac, timingSafeEqual } from "node:crypto";

/*
 * Pure logic behind /api/hooks/github, the automatic fallback for production deploys.
 *
 * Production is normally built by the Deploy workflow on GitHub Actions and uploaded prebuilt
 * (vercel.json turns Vercel's own Git builds off). When that workflow cannot do its job —
 * the monthly Actions minutes are gone (the run is created and fails at once), the runner
 * never starts, or the build times out — the repository webhook reports the finished run here
 * and the route POSTs the Vercel Deploy Hook, which builds the same branch on Vercel instead.
 */

/** The Deploy workflow, as `workflow_run.path` reports it (GitHub appends `@refs/heads/main`). */
export const DEPLOY_WORKFLOW_PATH = ".github/workflows/deploy.yml";
export const PRODUCTION_BRANCH = "main";
/** Conclusions that mean "no deployment happened"; `cancelled` is a newer push superseding the run. */
export const FALLBACK_CONCLUSIONS = ["failure", "startup_failure", "timed_out"] as const;

export interface WorkflowRunPayload {
  action?: unknown;
  workflow_run?: {
    path?: unknown;
    head_branch?: unknown;
    head_sha?: unknown;
    conclusion?: unknown;
    html_url?: unknown;
    run_attempt?: unknown;
  };
}

export type HookDecision =
  | { kind: "pong" }
  | { kind: "ignore"; why: string }
  | { kind: "fallback"; conclusion: string; sha: string; runUrl: string };

/** `X-Hub-Signature-256` = "sha256=" + hex HMAC-SHA256 of the raw body under the webhook secret. */
export function signatureMatches(rawBody: string, header: string | null | undefined, secret: string): boolean {
  if (!header || !header.startsWith("sha256=")) return false;
  const given = Buffer.from(header.slice("sha256=".length).toLowerCase(), "utf8");
  const expected = Buffer.from(createHmac("sha256", secret).update(rawBody).digest("hex"), "utf8");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Convenience for tests and manual checks: the header value GitHub would send for this body. */
export function signBody(rawBody: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
}

/** What to do with a verified delivery: answer the ping, ignore everything irrelevant, or fall back. */
export function decideFallback(event: string | null | undefined, payload: unknown): HookDecision {
  if (event === "ping") return { kind: "pong" };
  if (event !== "workflow_run") return { kind: "ignore", why: `event ${event ?? "(none)"}` };
  const p = (payload ?? {}) as WorkflowRunPayload;
  if (p.action !== "completed") return { kind: "ignore", why: `action ${String(p.action ?? "(none)")}` };
  const run = p.workflow_run ?? {};
  const path = typeof run.path === "string" ? run.path : "";
  if (!path.startsWith(DEPLOY_WORKFLOW_PATH)) return { kind: "ignore", why: `workflow ${path || "(none)"}` };
  if (run.head_branch !== PRODUCTION_BRANCH) return { kind: "ignore", why: `branch ${String(run.head_branch ?? "(none)")}` };
  const conclusion = typeof run.conclusion === "string" ? run.conclusion : "";
  if (!(FALLBACK_CONCLUSIONS as readonly string[]).includes(conclusion)) return { kind: "ignore", why: `conclusion ${conclusion || "(none)"}` };
  return {
    kind: "fallback",
    conclusion,
    sha: typeof run.head_sha === "string" ? run.head_sha : "",
    runUrl: typeof run.html_url === "string" ? run.html_url : "",
  };
}
