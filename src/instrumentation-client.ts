/*
 * Client-side error capture: runs before hydration and reports uncaught errors and unhandled
 * rejections to the self-hosted error inbox (POST /api/errors). Each distinct error is sent
 * once per page load and at most six per load. The server re-derives severity from the stack
 * (src/lib/errors.ts clientSeverity), so what we label here is only a hint: errors from our
 * own bundle are "error", noise from extensions or third-party scripts is "warn".
 */

const sent = new Set<string>();
let budget = 6;

const IGNORE = [
  /ResizeObserver loop/i,
  /^Script error\.?$/i,
  /Non-Error promise rejection captured/i,
  /^Load failed$/i, // Safari: a fetch aborted by navigation
  /NetworkError when attempting to fetch resource/i,
  /^Failed to fetch$/i,
  /AbortError/i,
];

type Report = { name: string; message: string; stack?: string; source: string };

function report(payload: Report): void {
  try {
    if (budget <= 0) return;
    if (IGNORE.some((re) => re.test(payload.message) || re.test(payload.name))) return;
    const key = `${payload.name}:${payload.message}`.slice(0, 200);
    if (sent.has(key)) return;
    sent.add(key);
    budget--;
    const stack = payload.stack ?? "";
    const ours = stack.includes(`${location.origin}/_next/`) || stack.includes("/_next/static/");
    const fromExtension = /(chrome|moz|safari|safari-web)-extension:\/\//.test(stack);
    const body = JSON.stringify({
      name: payload.name.slice(0, 200),
      message: payload.message.slice(0, 2000),
      stack: stack.slice(0, 8000) || undefined,
      source: payload.source,
      route: location.pathname,
      severity: ours && !fromExtension ? "error" : "warn",
      userAgent: navigator.userAgent.slice(0, 400),
    });
    const blob = new Blob([body], { type: "application/json" });
    if (!navigator.sendBeacon?.("/api/errors", blob)) {
      fetch("/api/errors", { method: "POST", body, headers: { "Content-Type": "application/json" }, keepalive: true }).catch(() => {});
    }
  } catch {
    /* the reporter must never throw */
  }
}

try {
  window.addEventListener("error", (event) => {
    // Resource load failures (img/script 404s) bubble here without an error object: skip them.
    if (!(event instanceof ErrorEvent)) return;
    const err = event.error as Error | undefined;
    report({
      name: err?.name ?? "Error",
      message: err?.message ?? event.message ?? "Unknown error",
      stack: err?.stack ?? (event.filename ? `at ${event.filename}:${event.lineno}:${event.colno}` : undefined),
      source: "window.onerror",
    });
  });
  window.addEventListener("unhandledrejection", (event) => {
    const r = event.reason as Error | string | undefined;
    const isObj = typeof r === "object" && r !== null;
    report({
      name: isObj ? ((r as Error).name ?? "UnhandledRejection") : "UnhandledRejection",
      message: isObj ? ((r as Error).message ?? String(r)) : String(r),
      stack: isObj ? (r as Error).stack : undefined,
      source: "unhandledrejection",
    });
  });
} catch {
  /* instrumentation must never break the page */
}

/** For client components that catch their own errors (uploads, polling) and still want them in the inbox. */
export function reportClientError(err: unknown, source: string): void {
  const e = err as Error | undefined;
  report({ name: e?.name ?? "Error", message: e?.message ?? String(err), stack: e?.stack, source });
}
