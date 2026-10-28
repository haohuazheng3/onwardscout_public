import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { OnboardingFlow } from "@/components/onboarding/OnboardingFlow";
import { routing } from "@/i18n/routing";
import { emptyProfile } from "@/lib/core/types";
import { captureError } from "@/lib/errors";
import { claimAnonymousDraft } from "@/lib/profile";
import { readAnonId } from "@/lib/profile/anon";
import { EMPTY_STATUS } from "@/lib/profile/draft-route";
import { draftStatus } from "@/lib/profile/status";
import { getFacts, getProfile, profileOf } from "@/lib/profile/store";
import { optionalUser } from "@/lib/user";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: hasLocale(routing.locales, locale) ? locale : "en", namespace: "onboarding" });
  return { title: t("metaTitle"), description: t("metaDescription") };
}

/**
 * /app/start — the "no typing" onboarding, one question per screen (OnboardingFlow).
 * Works signed out (anonymous draft, cookie `os_anon`) and signed in; after signing in from
 * the "save your scout" step (?claim=1) the draft is claimed here before anything loads.
 */
export default async function StartPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const sp = await searchParams;
  const claim = sp.claim === "1";

  const session = await optionalUser();
  let ownerId: string | null = session?.userId ?? null;
  if (session && claim) {
    const anonId = await readAnonId();
    if (anonId) {
      try {
        await claimAnonymousDraft(anonId, session.userId, { email: session.email, locale });
      } catch (err) {
        // The client retries through /api/drafts/claim; the page still renders.
        await captureError(err, { route: "/[locale]/app/start (claim)", context: { userId: session.userId } });
      }
    }
  }
  if (!session) ownerId = await readAnonId();

  const [status, row, facts] = ownerId ? await Promise.all([draftStatus(ownerId, { locale }), getProfile(ownerId), getFacts(ownerId)]) : [EMPTY_STATUS, null, []];

  return (
    <OnboardingFlow
      mode={session ? "user" : "draft"}
      signedIn={Boolean(session)}
      locale={locale}
      claim={claim}
      status={JSON.parse(JSON.stringify(status))}
      profile={row ? profileOf(row) : emptyProfile()}
      confirmedPaths={facts.filter((f) => f.confirmedByUser).map((f) => f.path)}
    />
  );
}
