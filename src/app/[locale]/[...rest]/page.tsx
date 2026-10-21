import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";

/*
 * Catch-all under a locale: any path no page claims renders the localized 404 (with a real
 * 404 status). The proxy also rewrites forbidden admin requests here.
 */
export default async function CatchAll({ params }: { params: Promise<{ locale: string; rest: string[] }> }) {
  const { locale } = await params;
  if (hasLocale(routing.locales, locale)) setRequestLocale(locale);
  notFound();
}
