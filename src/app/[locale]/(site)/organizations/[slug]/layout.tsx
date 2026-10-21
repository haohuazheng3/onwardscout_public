import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { englishOnly } from "@/components/seo/english-only";
import { isValidSlug, listingsOfOrg, orgPath } from "@/lib/programmatic";

/** Guards above the page's loading boundary, so the /zh redirect and the 404 keep their HTTP status. */
export default async function OrganizationGuard({ children, params }: { children: ReactNode; params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  englishOnly(locale, orgPath(slug));
  if (!isValidSlug(slug)) notFound();
  if (!(await listingsOfOrg(slug)).length) notFound();
  return children;
}
