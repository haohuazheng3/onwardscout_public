import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, count, eq } from "drizzle-orm";
import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { loadMessages } from "@/i18n/messages";
import { localizePath } from "@/i18n/paths";
import { routing } from "@/i18n/routing";
import { db } from "@/lib/db";
import { messages } from "@/lib/db/schema";
import { integrationsTranslator } from "@/lib/integrations/i18n";
import { googleOAuthConfigured } from "@/lib/integrations/google/oauth";
import { getGoogleIntegration } from "@/lib/integrations/google/store";
import { ensureUser, getInboundAddress, requireUser } from "@/lib/user";
import type { GmailState } from "./GmailPanel";
import { IntegrationsView } from "./IntegrationsView";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = integrationsTranslator(hasLocale(routing.locales, locale) ? locale : "en");
  return { title: t("metaTitle") };
}

const FLASHES = new Set(["connected", "denied", "scope", "expired", "error", "unavailable"]);

export default async function IntegrationsPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const session = await requireUser({ locale, returnTo: localizePath("/app/integrations", locale) });
  const sp = await searchParams;
  const flash = typeof sp.gmail === "string" && FLASHES.has(sp.gmail) ? sp.gmail : null;

  // The drop-box address needs the users row; the shell only upserts it after the response.
  await ensureUser(session, { locale });
  const [integration, inbound, sent, common] = await Promise.all([
    getGoogleIntegration(session.userId),
    getInboundAddress(session.userId),
    db
      .select({ n: count() })
      .from(messages)
      .where(and(eq(messages.userId, session.userId), eq(messages.channel, "gmail"), eq(messages.direction, "out"), eq(messages.status, "sent"))),
    loadMessages(locale, ["common"]),
  ]);
  const configured = googleOAuthConfigured();
  const connected = configured && integration?.status === "active" && integration.hasToken;
  const gmail: GmailState = {
    configured,
    connected,
    email: connected ? (integration?.accountEmail ?? null) : null,
    status: integration?.status ?? null,
    connectedAt: connected && integration ? integration.updatedAt.toISOString() : null,
    sentCount: sent[0]?.n ?? 0,
  };

  return <IntegrationsView locale={locale} gmail={gmail} inbound={inbound} flash={flash} common={common} />;
}
