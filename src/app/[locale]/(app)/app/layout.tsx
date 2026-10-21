import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { after } from "next/server";
import type { ReactNode } from "react";
import { AppShell } from "@/components/AppNav";
import { routing } from "@/i18n/routing";
import { captureError } from "@/lib/errors";
import { ensureUser, optionalUser } from "@/lib/user";

/*
 * The signed-in shell around every /app page: floating rail (desktop), top bar with credits,
 * notifications and the account button, floating tab bar (phones). The proxy guarantees a
 * session before this renders. The shell does no blocking per-user server work, so a route
 * change paints the target's loading.tsx skeleton inside the shell at once: the local `users`
 * row is upserted after the response (`after`), and pages that need the row themselves call
 * `ensureUser(session)` (deduplicated per request).
 *
 * Slots: <AppShell credits={…} notifications={…}> replaces the default live badge / bell.
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

  return <AppShell>{children}</AppShell>;
}
