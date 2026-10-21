import { useTranslations } from "next-intl";
import { DetailSkeleton } from "@/components/Skeletons";

export default function OpportunityLoading() {
  // The skeleton is announced in the page language (the layout set the request locale).
  const label = useTranslations("common")("status.loading");
  return <DetailSkeleton label={label} />;
}
