import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { after } from "next/server";
import type { ReactNode } from "react";
import { AppShell } from "@/components/AppNav";
import { NotificationsBell } from "@/components/notifications/NotificationsBell";
import { ClaimDraft } from "@/components/onboarding/ClaimDraft";
import { routing } from "@/i18n/routing";
import { captureError } from "@/lib/errors";
import { readAnonId } from "@/lib/profile/anon";
import { ensureUser, optionalUser } from "@/lib/user";

/*
 * The signed-in shell around every /app page: floating rail (desktop), top bar with credits,
 * notifications and the account button, floating tab bar (phones). The proxy guarantees a
 * session before this renders — except on /app/start, which works signed out (anonymous
 * draft) and gets the slim guest bar. The shell does no blocking per-user server work, so a
 * route change paints the target's loading.tsx skeleton inside the shell at once: the local
 * `users` row is upserted after the response (`after`; its first run grants the trial
 * credits), and pages that need the row themselves call `ensureUser(session)` (deduplicated
 * per request).
 *
 * Slots: the credit badge is the default live one (GET /api/me → balance from getBalance);
 * the bell is P6's NotificationsBell. A signed-in person who still carries an anonymous draft
 * cookie gets it claimed (ClaimDraft → POST /api/drafts/claim, which also clears the cookie).
 */
export default async function AppShellLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale = hasLocale(routing.locales, raw) ? raw : routing.defaultLocale;
  setRequestLocale(locale);

  const session = await optionalUser();
  if (session) {
    after(async () => {
      try {
        await ensureUser(session, { locale });
      } catch (err) {
        await captureError(err, { route: "/[locale]/app (ensureUser)", source: "server" });
      }
    });
  }
  const pendingDraft = session ? Boolean(await readAnonId()) : false;

  return (
    <AppShell signedIn={Boolean(session)} notifications={<NotificationsBell />}>
      {pendingDraft ? <ClaimDraft /> : null}
      {children}
    </AppShell>
  );
}
