import { ClerkLoading, SignIn } from "@clerk/nextjs";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { SlimHeader } from "@/components/Header";
import { LogoMark } from "@/components/Logo";
import { ScoutDot } from "@/components/ui";
import { Link } from "@/i18n/navigation";
import { localizePath, localizeRedirect, safeRedirectPath } from "@/i18n/paths";
import { routing, type Locale } from "@/i18n/routing";
import { SITE } from "@/lib/site";
import { SignInFallback } from "./SignInFallback";

/*
 * One entry for everyone: enter your email → get a code → you're in. Clerk's <SignIn> with
 * sign-up folded in (the instance is email-code only), path routing under the localized
 * /sign-in. The destination afterwards is a sanitized same-site path from ?redirect_url=
 * (forced, so Clerk never follows an unchecked one), else the localized /app.
 */

type Props = {
  params: Promise<{ locale: string; "sign-in"?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function resolveLocale(raw: string): Locale {
  return hasLocale(routing.locales, raw) ? raw : routing.defaultLocale;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = resolveLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: "common.auth" });
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    alternates: { canonical: localizePath("/sign-in", locale) },
    robots: { index: false, follow: false },
  };
}

/** The post-sign-in destination: a checked same-site path in the visitor's language. */
function signInDestination(raw: string | string[] | undefined, locale: Locale): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const safe = safeRedirectPath(value, { siteOrigin: SITE.url });
  return safe ? localizeRedirect(safe, locale) : localizePath("/app", locale);
}

function SignInCardSkeleton() {
  return (
    <div aria-hidden="true">
      <span className="skeleton block h-7 w-56 max-w-full rounded-[10px]" />
      <span className="skeleton mt-3 block h-4 w-72 max-w-full rounded-full" />
      <span className="skeleton mt-8 block h-3 w-24 rounded-full" />
      <span className="skeleton mt-3 block h-[52px] w-full rounded-[16px]" />
      <span className="skeleton mt-5 block h-[52px] w-full rounded-full" />
    </div>
  );
}

export default async function SignInPage({ params, searchParams }: Props) {
  const locale = resolveLocale((await params).locale);
  setRequestLocale(locale);
  const [sp, t] = await Promise.all([searchParams, getTranslations({ locale, namespace: "common.auth" })]);
  const destination = signInDestination(sp.redirect_url, locale);

  const points = [
    { title: t("point1Title"), body: t("point1Body") },
    { title: t("point2Title"), body: t("point2Body") },
    { title: t("point3Title"), body: t("point3Body") },
  ];

  return (
    <>
      <SlimHeader />
      <main id="main" className="safe-x pb-20 pt-4 sm:px-6 sm:pt-10">
        <div className="mx-auto grid max-w-[1080px] items-start gap-10 lg:grid-cols-[minmax(0,1fr)_460px] lg:gap-16">
          <section className="order-2 min-w-0 lg:order-1 lg:pt-8">
            <p className="eyebrow eyebrow-accent eyebrow-dot">{t("eyebrow")}</p>
            <h1 className="display mt-4 text-[2.35rem] text-ink sm:text-[3.3rem]">{t.rich("title", { em: (chunks) => <em>{chunks}</em> })}</h1>
            <p className="lede mt-5 max-w-md">{t("lede")}</p>

            <h2 className="eyebrow mt-10">{t("nextTitle")}</h2>
            <ol className="relative mt-4 space-y-3">
              <span
                aria-hidden="true"
                className="absolute bottom-8 left-[19px] top-8 border-l-2 border-dotted border-line-2"
              />
              {points.map((p, i) => {
                const last = i === points.length - 1;
                return (
                  <li key={p.title} className="relative flex gap-4">
                    <span
                      className={`num relative z-10 mt-2 grid h-10 w-10 shrink-0 place-items-center rounded-full text-[0.9rem] font-semibold ${
                        last ? "bg-pine text-void" : "bg-pane text-ink shadow-pane"
                      }`}
                      aria-hidden="true"
                    >
                      {i + 1}
                    </span>
                    <div className="pane-inset min-w-0 flex-1 px-4 py-3.5 sm:px-5">
                      <p className="text-[0.98rem] font-semibold text-ink">{p.title}</p>
                      <p className="mt-1 text-[0.9rem] leading-relaxed text-ink-3">{p.body}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
            <p className="mt-6 flex items-center gap-2.5 text-[0.92rem] text-ink-2">
              <ScoutDot />
              {t("free")}
            </p>
          </section>

          <div className="order-1 min-w-0 lg:order-2 lg:sticky lg:top-8">
            <div className="pane-ink p-5 sm:p-8">
              <div className="mb-6 flex items-center gap-2.5">
                <LogoMark size={24} tone="light" />
                <span className="eyebrow text-accent-text">{t("cardEyebrow")}</span>
              </div>
              <ClerkLoading>
                <SignInCardSkeleton />
              </ClerkLoading>
              <SignInFallback />
              <SignIn
                withSignUp
                routing="path"
                path={localizePath("/sign-in", locale)}
                forceRedirectUrl={destination}
                signUpForceRedirectUrl={destination}
                fallbackRedirectUrl={destination}
                signUpFallbackRedirectUrl={destination}
              />
              <p className="mt-6 text-[0.8rem] leading-relaxed text-ink-3">
                {t.rich("legal", {
                  terms: (chunks) => (
                    <Link href="/terms" className="underline underline-offset-2 hover:text-ink">
                      {chunks}
                    </Link>
                  ),
                  privacy: (chunks) => (
                    <Link href="/privacy" className="underline underline-offset-2 hover:text-ink">
                      {chunks}
                    </Link>
                  ),
                })}
              </p>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
