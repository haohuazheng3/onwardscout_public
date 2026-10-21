import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import type { ReactNode } from "react";
import { SlimHeader } from "@/components/Header";
import { LegalLinks } from "@/components/LegalLinks";
import { routing } from "@/i18n/routing";

/*
 * /checkout/success sits inside the (app) area (Clerk, all app messages) but outside the /app
 * shell: a slim header with the logo, the language switcher and the way back to the website.
 */
export default async function CheckoutSuccessLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale = hasLocale(routing.locales, raw) ? raw : routing.defaultLocale;
  setRequestLocale(locale);
  return (
    <>
      <SlimHeader />
      <main id="main" className="min-h-screen-d">
        {children}
      </main>
      <footer className="safe-x mx-auto max-w-3xl pb-10 sm:px-6">
        <LegalLinks className="justify-center" />
      </footer>
    </>
  );
}
