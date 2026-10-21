import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { englishOnly } from "@/components/seo/english-only";
import { careerPath } from "@/lib/programmatic";
import { isOccupationCode } from "@/lib/core/occupations";

/** Guards above the page's loading boundary, so the /zh redirect and the 404 keep their HTTP status. */
export default async function CareerGuard({ children, params }: { children: ReactNode; params: Promise<{ locale: string; occupation: string }> }) {
  const { locale, occupation } = await params;
  englishOnly(locale, careerPath(occupation));
  if (!isOccupationCode(occupation)) notFound();
  return children;
}
