"use client";

import { Mail, Send, Unplug } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Button, buttonClasses, Callout, cx, Pane, Tag } from "@/components/ui";
import { toast } from "@/components/ui-client";

/*
 * Gmail connection card. Connect is a full navigation (our start route → Google's consent
 * screen), so the button shows its pressed state at once; disconnect flips the card instantly
 * and rolls back with a toast if the server refuses; the test email shows progress on the
 * button and the outcome as a toast. The one-word `?gmail=` outcome from the OAuth callback is
 * turned into a toast and removed from the address bar.
 */

export interface GmailState {
  configured: boolean;
  connected: boolean;
  email: string | null;
  status: "active" | "revoked" | "error" | null;
  connectedAt: string | null;
  sentCount: number;
}

const FLASH_TONES: Record<string, "success" | "info" | "warn" | "error"> = {
  connected: "success",
  denied: "info",
  scope: "warn",
  expired: "warn",
  error: "error",
  unavailable: "info",
};

export function GmailPanel({ initial, flash, locale }: { initial: GmailState; flash: string | null; locale: "en" | "zh" }) {
  const t = useTranslations("integrations");
  const tc = useTranslations("common");
  const format = useFormatter();
  const [state, setState] = useState(initial);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [testing, setTesting] = useState(false);
  const flashShown = useRef(false);

  useEffect(() => {
    if (!flash || flashShown.current) return;
    flashShown.current = true;
    const tone = FLASH_TONES[flash];
    if (tone) toast({ title: t(`flash.${flash}`), tone });
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("gmail");
      window.history.replaceState(window.history.state, "", url.toString());
    } catch {
      /* the address bar keeps the flag; harmless */
    }
  }, [flash, t]);

  // A page restored from the back/forward cache must not stay in "Opening Google…".
  useEffect(() => {
    const reset = () => setConnecting(false);
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);

  async function disconnect() {
    const before = state;
    setState({ ...state, connected: false, status: "revoked" });
    setDisconnecting(true);
    try {
      const res = await fetch("/api/integrations/google/disconnect", { method: "POST" });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? tc("errors.generic"));
      toast.success(t("gmail.disconnected"));
    } catch (err) {
      setState(before);
      toast.error(tc("errors.rolledBack"), { body: err instanceof Error ? err.message : undefined });
    } finally {
      setDisconnecting(false);
    }
  }

  async function sendTest() {
    setTesting(true);
    try {
      const res = await fetch("/api/integrations/google/test", { method: "POST" });
      const json = (await res.json().catch(() => null)) as { to?: string; error?: string } | null;
      if (!res.ok) throw new Error(json?.error ?? t("errors.sendFailed"));
      toast.success(t("gmail.testSent", { email: json?.to ?? state.email ?? "" }));
    } catch (err) {
      toast.error(t("errors.sendFailed"), { body: err instanceof Error ? err.message : undefined });
    } finally {
      setTesting(false);
    }
  }

  const needsReconnect = state.configured && !state.connected && state.status === "error";
  const statusLine = !state.configured
    ? t("gmail.statusUnavailable")
    : state.connected
      ? t("gmail.statusConnected", { email: state.email ?? "" })
      : needsReconnect
        ? t("gmail.statusError")
        : t("gmail.statusNotConnected");
  const startHref = `/api/integrations/google/start?locale=${locale}`;

  return (
    <Pane pad="md" className="min-w-0" aria-labelledby="gmail-title">
      <div className="flex min-w-0 items-start gap-4">
        <span className="pane-inset grid size-12 shrink-0 place-items-center text-ink-2" aria-hidden>
          <Mail size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="gmail-title" className="title text-[1.25rem] text-ink">
              {t("gmail.title")}
            </h2>
            {state.connected ? (
              <Tag tone="ok" dot>
                {t("gmail.badgeConnected")}
              </Tag>
            ) : null}
          </div>
          <p className={cx("mt-1 min-w-0 break-words text-[0.95rem]", needsReconnect ? "font-medium text-warn" : "text-ink-3")} aria-live="polite">
            {statusLine}
          </p>
        </div>
      </div>

      <p className="mt-5 text-[0.98rem] leading-relaxed text-ink-2">{t("gmail.body")}</p>

      {!state.configured ? (
        <Callout tone="info" className="mt-5">
          {t("gmail.unavailableBody")}
        </Callout>
      ) : needsReconnect ? (
        <Callout tone="warn" className="mt-5">
          {t("gmail.errorBody")}
        </Callout>
      ) : null}

      {state.configured ? (
        <div className="mt-6 flex flex-wrap items-center gap-3">
          {state.connected ? (
            <>
              <Button variant="ghost" icon={<Send size={17} aria-hidden />} loading={testing} onClick={sendTest}>
                {testing ? t("gmail.sending") : t("gmail.sendTest")}
              </Button>
              <Button variant="quiet" icon={<Unplug size={17} aria-hidden />} aria-busy={disconnecting || undefined} onClick={disconnect}>
                {disconnecting ? t("gmail.disconnecting") : t("gmail.disconnect")}
              </Button>
            </>
          ) : (
            <a
              href={startHref}
              onClick={() => setConnecting(true)}
              aria-busy={connecting || undefined}
              className={cx(buttonClasses({ variant: "primary" }), connecting && "pointer-events-none opacity-80")}
            >
              <Mail size={17} aria-hidden />
              <span className="btn-label">{connecting ? t("gmail.connecting") : needsReconnect || state.status === "revoked" ? t("gmail.reconnect") : t("gmail.connect")}</span>
            </a>
          )}
        </div>
      ) : null}

      <p className="mt-5 text-[0.88rem] text-ink-4">
        {t("gmail.sentCount", { count: state.sentCount })}
        {state.connected && state.connectedAt ? (
          <>
            {" · "}
            {t("gmail.connectedSince", { date: format.dateTime(new Date(state.connectedAt), { dateStyle: "medium" }) })}
          </>
        ) : null}
      </p>
    </Pane>
  );
}
