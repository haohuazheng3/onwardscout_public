import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Geist } from "next/font/google";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { ReactNode } from "react";
import { ConsentManager } from "@/components/Consent";
import { NavFeedback } from "@/components/NavFeedback";
import { THEME_SCRIPT } from "@/components/ThemeToggle";
import { IntlProvider } from "@/i18n/IntlProvider";
import { loadMessages } from "@/i18n/messages";
import { COMMON_NAMESPACES } from "@/i18n/namespaces";
import { TIME_ZONE } from "@/i18n/request";
import { HTML_LANG, OG_LOCALE, routing } from "@/i18n/routing";
import { isIndexable } from "@/lib/env";
import { SITE } from "@/lib/site";

/*
 * The real document for every page: <html lang>, fonts, the pre-paint theme script, the
 * empty field (.void-bg), the skip link, the `common` messages for client components and
 * the consent manager. No Clerk here: public pages stay static and fast.
 */

// UI, body copy and numerals. Variable weight, Latin subset; CJK falls back to the system fonts in --font-sans.
const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist",
  display: "swap",
});

// Display and headlines: optical size + width axes give the tight, slightly condensed set.
const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  axes: ["opsz", "wdth"],
  variable: "--font-bricolage",
  display: "swap",
});

type Params = { locale: string };

export function generateStaticParams(): Params[] {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "common.meta" });
  const indexable = isIndexable();
  return {
    metadataBase: new URL(SITE.url),
    title: { default: t("defaultTitle"), template: `%s · ${SITE.name}` },
    description: t("description"),
    applicationName: SITE.name,
    authors: [{ name: SITE.name, url: SITE.url }],
    creator: SITE.name,
    publisher: SITE.name,
    formatDetection: { telephone: false, email: false, address: false },
    robots: indexable
      ? { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 } }
      : { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
    // A nested `openGraph` replaces the parent's whole object, so the default card is named here
    // (src/app/opengraph-image.tsx → /opengraph-image); pages override it via pageMetadata().
    openGraph: {
      type: "website",
      siteName: SITE.name,
      locale: OG_LOCALE[locale],
      title: t("defaultTitle"),
      description: t("description"),
      images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: t("ogAlt") }],
    },
    twitter: { card: "summary_large_image", title: t("defaultTitle"), description: t("description"), images: ["/opengraph-image"] },
    appleWebApp: { capable: true, title: SITE.name, statusBarStyle: "default" },
    category: "productivity",
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F5F4F0" },
    { media: "(prefers-color-scheme: dark)", color: "#0E1210" },
  ],
};

export default async function LocaleLayout({ children, params }: { children: ReactNode; params: Promise<Params> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const [messages, t] = await Promise.all([
    loadMessages(locale, COMMON_NAMESPACES),
    getTranslations({ locale, namespace: "common.a11y" }),
  ]);

  return (
    <html lang={HTML_LANG[locale]} data-locale={locale} suppressHydrationWarning className={`${geist.variable} ${bricolage.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <div className="void-bg" aria-hidden="true" />
        <NavFeedback />
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[80] focus:rounded-full focus:bg-ink focus:px-5 focus:py-3 focus:text-[0.95rem] focus:font-semibold focus:text-void"
        >
          {t("skipToContent")}
        </a>
        <IntlProvider locale={locale} messages={messages} timeZone={TIME_ZONE}>
          {children}
          <ConsentManager />
        </IntlProvider>
      </body>
    </html>
  );
}
