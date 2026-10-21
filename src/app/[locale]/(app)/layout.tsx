import { ClerkProvider } from "@clerk/nextjs";
import { zhCN } from "@clerk/localizations/zh-CN";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import type { ReactNode } from "react";
import { IdentifyUser } from "@/components/IdentifyUser";
import { Toaster } from "@/components/ui-client";
import { IntlProvider } from "@/i18n/IntlProvider";
import { loadMessages } from "@/i18n/messages";
import { APP_NAMESPACES } from "@/i18n/namespaces";
import { localizePath } from "@/i18n/paths";
import { TIME_ZONE } from "@/i18n/request";
import { routing } from "@/i18n/routing";
import { clerkAppearance } from "@/lib/clerk-appearance";

/*
 * The personal area: sign-in, /app, checkout and admin. Clerk's JS loads only here; nothing
 * here is indexed or cached. Client components get every app namespace (the [locale]
 * layout gave them only `common`). Each page owns a loading.tsx skeleton.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};

export default async function AppAreaLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale = hasLocale(routing.locales, raw) ? raw : routing.defaultLocale;
  setRequestLocale(locale);
  const messages = await loadMessages(locale, APP_NAMESPACES);

  const signIn = localizePath("/sign-in", locale);
  const appHome = localizePath("/app", locale);

  return (
    <ClerkProvider
      appearance={clerkAppearance}
      localization={locale === "zh" ? zhCN : undefined}
      signInUrl={signIn}
      signUpUrl={signIn}
      signInFallbackRedirectUrl={appHome}
      signUpFallbackRedirectUrl={appHome}
      afterSignOutUrl={localizePath("/", locale)}
    >
      <IntlProvider locale={locale} messages={messages} timeZone={TIME_ZONE}>
        <IdentifyUser />
        {children}
        <Toaster />
      </IntlProvider>
    </ClerkProvider>
  );
}
