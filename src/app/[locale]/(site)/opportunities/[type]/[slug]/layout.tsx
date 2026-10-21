import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { englishOnly } from "@/components/seo/english-only";
import { permanentRedirect } from "@/i18n/navigation";
import { canonicalRedirect, getListingDetail, isShowable, isValidSlug } from "@/lib/programmatic";

/*
 * Guards for a listing page. They run here, above the page's loading boundary, so the /zh → English
 * redirect, the canonical-type redirect and the 404 keep their real HTTP status (inside the
 * boundary they would be streamed after a 200). The listing query is shared with the page (React cache).
 */
export default async function ListingGuard({ children, params }: { children: ReactNode; params: Promise<{ locale: string; type: string; slug: string }> }) {
  const { locale, type, slug } = await params;
  englishOnly(locale, `/opportunities/${type}/${slug}`);
  if (!isValidSlug(slug)) notFound();
  const d = await getListingDetail(slug);
  if (!isShowable(d)) notFound();
  const to = canonicalRedirect(type, d);
  if (to) permanentRedirect({ href: to, locale: "en" });
  return children;
}
