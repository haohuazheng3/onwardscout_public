"use client";

import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { LogoMark } from "@/components/Logo";
import { ButtonLink } from "@/components/ui";

/*
 * 404 for every localized path (unknown pages, the catch-all, admin for non-admins). A
 * client component so it can use the `common` messages from the layout's provider without
 * knowing the route params. Next adds `noindex` to not-found responses itself.
 */
export default function LocaleNotFound() {
  const t = useTranslations("common.notFound");
  return (
    <>
      <Header />
      <main id="main" className="safe-x pt-14 sm:px-6 sm:pt-24">
        <div className="pane mx-auto max-w-2xl px-6 py-14 text-center sm:px-12 sm:py-16">
          <div className="mx-auto grid h-20 w-20 animate-float place-items-center rounded-[26px] bg-pane-2 shadow-[inset_0_0_0_1px_var(--line)]">
            <LogoMark size={44} />
          </div>
          <p className="eyebrow eyebrow-dot mt-7">{t("eyebrow")}</p>
          <h1 className="display mt-4 text-[2.3rem] text-ink sm:text-[3.1rem]">{t("title")}</h1>
          <p className="lede mx-auto mt-4 max-w-md">{t("body")}</p>
          <div className="mt-8 flex flex-col justify-center gap-2.5 sm:flex-row">
            <ButtonLink href="/" iconRight={<ArrowRight size={17} aria-hidden />}>
              {t("home")}
            </ButtonLink>
            <ButtonLink href="/opportunities" locale="en" variant="ghost">
              {t("opportunities")}
            </ButtonLink>
            <ButtonLink href="/app" prefetch={false} variant="quiet">
              {t("board")}
            </ButtonLink>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
