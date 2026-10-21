import { useTranslations } from "next-intl";
import { DetailSkeleton } from "@/components/Skeletons";

export default function Loading() {
  const label = useTranslations("common")("status.loading");
  return <DetailSkeleton label={label} />;
}
