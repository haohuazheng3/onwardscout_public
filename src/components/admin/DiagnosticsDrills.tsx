"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button, cx } from "@/components/ui";
import { Link } from "@/i18n/navigation";

/*
 * Admin drills. Each one calls POST /api/admin/diagnostics?action=… (admin-only: the proxy 404s
 * everyone else and the route re-checks). A button flips to its busy state on press and the
 * result lands in the drill log of this tab.
 */

export type DrillId = "throw" | "client" | "resolve" | "ping-mail" | "ping-files" | "owner-alert" | "notify-test" | "digest-test";

interface LogLine {
  at: string;
  tone: "ok" | "bad" | "neutral";
  text: string;
  href?: string;
}

interface DrillResponse {
  ok?: boolean;
  error?: string;
  resolved?: number;
  status?: number;
  ms?: number;
  service?: string | null;
  emailQueued?: boolean;
  sent?: boolean;
  reason?: string;
  title?: string;
}

const ACTION: Record<Exclude<DrillId, "client">, string> = {
  throw: "throw",
  resolve: "resolve-drills",
  "ping-mail": "ping-mail",
  "ping-files": "ping-files",
  "owner-alert": "owner-alert",
  "notify-test": "notify-test",
  "digest-test": "digest-test",
};

function clock(): string {
  return new Date().toLocaleTimeString("en-GB", { hour12: false });
}

export function DiagnosticsDrills({ include }: { include: DrillId[] }) {
  const t = useTranslations("admin.diagnostics");
  const [busy, setBusy] = useState<DrillId | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);

  const push = (line: Omit<LogLine, "at">) => setLog((l) => [{ at: clock(), ...line }, ...l].slice(0, 12));

  async function call(id: Exclude<DrillId, "client">): Promise<DrillResponse & { httpStatus: number }> {
    const res = await fetch(`/api/admin/diagnostics?action=${ACTION[id]}`, { method: "POST", headers: { Accept: "application/json" }, cache: "no-store" });
    const body = ((await res.json().catch(() => null)) as DrillResponse | null) ?? { error: `HTTP ${res.status}` };
    return { ...body, httpStatus: res.status };
  }

  async function run(id: DrillId) {
    if (busy) return;
    if (id === "client") {
      push({ tone: "ok", text: t("drill.clientOk"), href: "/admin/errors" });
      window.setTimeout(() => {
        throw new Error(`Diagnostics: deliberate client error at ${new Date().toISOString()}`);
      }, 0);
      return;
    }
    setBusy(id);
    try {
      const r = await call(id);
      const failed = (reason?: string) => push({ tone: "bad", text: t("drill.failed", { reason: reason ?? r.error ?? `HTTP ${r.httpStatus}` }) });
      switch (id) {
        case "throw":
          if (r.httpStatus === 500) push({ tone: "ok", text: t("drill.throwOk"), href: "/admin/errors" });
          else push({ tone: "bad", text: t("drill.throwUnexpected", { status: r.httpStatus }) });
          break;
        case "resolve":
          if (r.ok) push({ tone: "ok", text: t("drill.resolveOk", { count: r.resolved ?? 0 }) });
          else failed();
          break;
        case "ping-mail":
        case "ping-files":
          if (r.ok) push({ tone: "ok", text: t("drill.pingOk", { service: r.service ?? id, ms: r.ms ?? 0 }) });
          else push({ tone: "bad", text: t("drill.pingFailed", { reason: r.error ?? `HTTP ${r.status ?? r.httpStatus}` }) });
          break;
        case "owner-alert":
          if (r.ok) push({ tone: "ok", text: t("drill.alertOk") });
          else failed();
          break;
        case "notify-test":
          if (r.ok) push({ tone: "ok", text: t("drill.notifyOk") + (r.emailQueued ? t("drill.notifyEmail") : ""), href: "/app" });
          else failed();
          break;
        case "digest-test":
          if (r.ok && r.sent) push({ tone: "ok", text: t("drill.digestOk", { title: r.title ?? "" }), href: "/app" });
          else if (r.reason) push({ tone: "neutral", text: t("drill.digestSkipped", { reason: r.reason }) });
          else failed();
          break;
      }
    } catch (err) {
      push({ tone: "bad", text: t("drill.failed", { reason: err instanceof Error ? err.message : String(err) }) });
    } finally {
      setBusy(null);
    }
  }

  const DRILLS: Record<DrillId, { title: string; body: string; button: string; primary?: boolean }> = {
    throw: { title: t("drill.throwTitle"), body: t("drill.throwBody"), button: t("drill.throwButton"), primary: true },
    client: { title: t("drill.clientTitle"), body: t("drill.clientBody"), button: t("drill.clientButton") },
    resolve: { title: t("drill.resolveTitle"), body: t("drill.resolveBody"), button: t("drill.resolveButton") },
    "ping-mail": { title: t("drill.mailTitle"), body: t("drill.mailBody"), button: t("drill.pingButton") },
    "ping-files": { title: t("drill.filesTitle"), body: t("drill.filesBody"), button: t("drill.pingButton") },
    "owner-alert": { title: t("drill.alertTitle"), body: t("drill.alertBody"), button: t("drill.alertButton") },
    "notify-test": { title: t("drill.notifyTitle"), body: t("drill.notifyBody"), button: t("drill.notifyButton") },
    "digest-test": { title: t("drill.digestTitle"), body: t("drill.digestBody"), button: t("drill.digestButton") },
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 [&>*]:min-w-0">
        {include.map((id) => {
          const d = DRILLS[id];
          return (
            <div key={id} className="pane flex flex-col justify-between gap-4 p-5">
              <div>
                <p className="font-semibold text-ink">{d.title}</p>
                <p className="mt-1 text-[0.88rem] leading-relaxed text-ink-3">{d.body}</p>
              </div>
              <Button variant={d.primary ? "primary" : "ghost"} size="sm" className="w-full sm:w-auto" loading={busy === id} disabled={busy !== null && busy !== id} onClick={() => void run(id)}>
                {d.button}
              </Button>
            </div>
          );
        })}
      </div>
      <div className="pane-inset px-4 py-3">
        <p className="eyebrow">{t("log")}</p>
        {log.length === 0 ? (
          <p className="mt-2 text-[0.88rem] text-ink-4">{t("logEmpty")}</p>
        ) : (
          <ul className="mt-2 space-y-1.5 text-[0.88rem]" aria-live="polite">
            {log.map((l, i) => (
              <li key={`${l.at}-${i}`} className={cx("break-words", l.tone === "ok" ? "text-ok" : l.tone === "bad" ? "text-bad" : "text-ink-2")}>
                <span className="font-mono text-[0.78rem] text-ink-4">{l.at}</span> {l.text}
                {l.href ? (
                  <>
                    {" "}
                    <Link href={l.href} prefetch={false} className="underline underline-offset-2">
                      {t("drill.open")}
                    </Link>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
