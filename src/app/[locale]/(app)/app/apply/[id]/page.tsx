import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ApplyFlow } from "@/components/applications/ApplyFlow";
import { localizePath } from "@/i18n/paths";
import { routing } from "@/i18n/routing";
import { applicationFor, applyPreview, applyTarget, hasMaterial, isClosedRound } from "@/lib/applications/apply";
import { settleUnlockSession } from "@/lib/applications/unlock";
import { getOpportunityType, isOpportunityTypeId } from "@/lib/core/opportunity-types";
import { captureError } from "@/lib/errors";
import { draftNeedsConsent } from "@/lib/profile/claim-consent";
import { claimAnonymousDraft } from "@/lib/profile";
import { readAnonId } from "@/lib/profile/anon";
import { EMPTY_STATUS } from "@/lib/profile/draft-route";
import { draftStatus } from "@/lib/profile/status";
import { applyPath, signInPath } from "@/lib/site";
import { optionalUser } from "@/lib/user";

type Props = { params: Promise<{ locale: string; id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: hasLocale(routing.locales, locale) ? locale : "en", namespace: "applications" });
  return { title: t("apply.metaTitle"), robots: { index: false, follow: false } };
}

/**
 * /app/apply/<opportunity id> — "Let Onward Scout apply for me" from a listing page. Works
 * signed out: the résumé dropped here starts an anonymous draft and this programme's materials
 * are drafted at once (lib/applications/apply.ts); signing in to save claims the draft here and
 * continues in the application room. Signed in, it goes straight to the room.
 */
export default async function ApplyPage({ params, searchParams }: Props) {
  const { locale, id } = await params;
  const sp = await searchParams;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  if (!/^opp_[0-9a-z]{6,40}$/.test(id)) notFound();
  const opp = await applyTarget(id);
  if (!opp) notFound();

  const session = await optionalUser();
  const anonId = await readAnonId();
  // The draft this page saved ("Save it, free") is the person's own; any other draft in the
  // browser waits for their yes when the account already has a profile (the shell asks).
  const ownDraft = Boolean(session && anonId && ((await applicationFor(anonId, opp.id)) || !(await draftNeedsConsent(anonId, session.userId))));
  if (session && anonId && ownDraft) {
    try {
      await claimAnonymousDraft(anonId, session.userId, { email: session.email, locale });
    } catch (err) {
      // The shell's ClaimDraft retries through /api/drafts/claim; the page still renders.
      await captureError(err, { route: "/[locale]/app/apply/[id] (claim)", context: { userId: session.userId } });
    }
  }
  const ownerId = session?.userId ?? anonId;
  const existing = ownerId ? await applicationFor(ownerId, opp.id) : null;
  if (session && existing) redirect(localizePath(`/app/applications/${existing.id}${typeof sp.session_id === "string" ? `?session_id=${encodeURIComponent(sp.session_id)}` : ""}`, locale));

  // Back from Stripe signed out: confirm the $19 with Stripe here (the webhook and the daily
  // reconcile are the fallbacks), unlock the application and start Claude's full run.
  let payment: "unlocked" | "pending" | "failed" | null = null;
  if (typeof sp.session_id === "string" && ownerId && existing) {
    const settled = await settleUnlockSession(sp.session_id, ownerId);
    payment = settled.state === "unlocked" ? "unlocked" : settled.state === "pending" ? "pending" : settled.state === "failed" ? "failed" : null;
  }

  const [status, material, preview] = ownerId
    ? await Promise.all([draftStatus(ownerId, { locale }), hasMaterial(ownerId), existing ? applyPreview(ownerId, existing.id) : Promise.resolve(null)])
    : [EMPTY_STATUS, false, null];
  const typeLabel = isOpportunityTypeId(opp.type) ? getOpportunityType(opp.type).label[locale === "zh" ? "zh" : "en"] : opp.type;

  return (
    <ApplyFlow
      locale={locale}
      signedIn={Boolean(session)}
      opportunity={{ id: opp.id, name: opp.name, orgName: opp.orgName, type: opp.type, typeLabel, url: opp.url, deadline: opp.deadline?.toISOString() ?? null, rolling: opp.rolling, closed: isClosedRound(opp) }}
      hasMaterial={material}
      status={JSON.parse(JSON.stringify(status))}
      preview={preview}
      saveHref={signInPath(locale === "zh" ? "zh" : "en", localizePath(applyPath(opp.id), locale))}
      payment={payment}
    />
  );
}
