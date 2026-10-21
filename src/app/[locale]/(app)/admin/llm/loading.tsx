import { useTranslations } from "next-intl";
import { PaneSkeleton } from "@/components/Skeletons";

export default function Loading() {
  const label = useTranslations("common")("status.loading");
  return (
    <div className="space-y-4" aria-busy="true">
      <span className="skeleton block h-9 w-40 rounded-[12px]" />
      <PaneSkeleton lines={3} label={label} />
      <div className="grid gap-4 lg:grid-cols-2">
        <PaneSkeleton lines={8} />
        <PaneSkeleton lines={8} />
      </div>
    </div>
  );
}
