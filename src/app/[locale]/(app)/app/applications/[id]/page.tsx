import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ApplicationRoom } from "@/components/applications/ApplicationRoom";
import { ButtonLink, EmptyState } from "@/components/ui";
import { localizePath } from "@/i18n/paths";
import { routing } from "@/i18n/routing";
import { applicationView } from "@/lib/applications";
import { enqueuePrepare } from "@/lib/applications/engine";
import { settleUnlockSession } from "@/lib/applications/unlock";
import { getBalance, roomBalance } from "@/lib/credits";
import { captureError } from "@/lib/errors";
import { requireUser } from "@/lib/user";

export const dynamic = "force-dynamic";

type Params = Promise<{ locale: string; id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: hasLocale(routing.locales, locale) ? locale : "en", namespace: "applications" });
  return { title: t("meta.title") };
}

export default async function ApplicationRoomPage({ params, searchParams }: { params: Params; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const { userId } = await requireUser({ locale, returnTo: localizePath(`/app/applications/${id}`, locale) });
  const valid = /^app_[0-9a-hjkmnp-tv-z]{6,40}$/.test(id);
  // Back from Stripe: confirm the unlock with Stripe before the room renders (webhook + reconcile are the fallbacks).
  const sp = await searchParams;
  let payment: "unlocked" | "pending" | "failed" | null = null;
  if (valid && typeof sp.session_id === "string") {
    const settled = await settleUnlockSession(sp.session_id, userId);
    payment = settled.state === "unlocked" ? "unlocked" : settled.state === "pending" ? "pending" : settled.state === "failed" ? "failed" : null;
  }
  const [t, view] = await Promise.all([getTranslations({ locale, namespace: "applications" }), valid ? applicationView(userId, id) : Promise.resolve(null)]);
  // What THIS application can use: general credits plus a season pass that covers its type.
  const balance = view
    ? await getBalance(userId, { opportunityType: view.opportunity.type }).catch(async (err: unknown) => {
        await captureError(err, { route: "/app/applications/[id] (balance)", severity: "warn" });
        return null;
      })
    : null;
  if (!view) {
    return (
      <EmptyState
        title={t("room.notFoundTitle")}
        body={t("room.notFoundBody")}
        action={<ButtonLink href="/app/applications">{t("room.back")}</ButtonLink>}
      />
    );
  }
  // Waiting for answers with nothing drafted yet (it started before materials came first): draft now.
  if (view.status === "needs_info" && !view.documents.length && !view.working) {
    await enqueuePrepare({ id: view.id, userId }).catch((err: unknown) => captureError(err, { route: "/app/applications/[id] (draft first)", severity: "warn" }));
    view.working = { kind: "prepare", step: "compose" };
  }
  return <ApplicationRoom initial={view} balance={balance ? roomBalance(balance) : null} locale={locale} nowIso={new Date().toISOString()} payment={payment} />;
}
