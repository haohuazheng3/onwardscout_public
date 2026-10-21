import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import type { ReactNode } from "react";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { JsonLd } from "@/components/JsonLd";
import { Toaster } from "@/components/ui-client";
import { routing } from "@/i18n/routing";
import { organizationLd, websiteLd } from "@/lib/seo";

/*
 * Every public page: floating header pill, the page, the floating footer pane. No Clerk and
 * no per-request work, so the whole group is static HTML from the CDN. The Organization and
 * WebSite nodes are emitted once here; pages add their own (FAQPage, HowTo, Breadcrumb…)
 * and reference the organization by its @id.
 */
export default async function SiteLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const l = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  setRequestLocale(l);
  return (
    <>
      <JsonLd data={[organizationLd(), websiteLd(l)]} />
      <Header />
      <main id="main" className="min-h-[60vh]">
        {children}
      </main>
      <Footer />
      <Toaster />
    </>
  );
}
