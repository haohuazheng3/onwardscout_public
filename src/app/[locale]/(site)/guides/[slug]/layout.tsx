import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { englishOnly } from "@/components/seo/english-only";
import { GUIDES_PATH, resolveGuide } from "@/lib/programmatic";

/** Guards above the page's loading boundary, so the /zh redirect and the 404 keep their HTTP status. */
export default async function GuideGuard({ children, params }: { children: ReactNode; params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  englishOnly(locale, `${GUIDES_PATH}/${slug}`);
  if (!(await resolveGuide(slug))) notFound();
  return children;
}
