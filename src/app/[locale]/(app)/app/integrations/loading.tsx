import { useTranslations } from "next-intl";
import { PaneSkeleton } from "@/components/Skeletons";
import { Skeleton } from "@/components/ui";

/** Integrations: header, the Gmail card and the drop-box card on the left, the scope list on the right. */
export default function IntegrationsLoading() {
  // The skeleton is announced in the page language (the layout set the request locale).
  const label = useTranslations("common")("status.loading");
  return (
    <div aria-busy="true">
      <div className="pb-6 sm:pb-8">
        <Skeleton width="7rem" height="0.8rem" />
        <div className="mt-3">
          <Skeleton width="min(22rem, 80%)" height="2.2rem" />
        </div>
        <div className="mt-3">
          <Skeleton width="min(34rem, 95%)" height="1rem" />
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:items-start">
        <div className="grid min-w-0 gap-4">
          <PaneSkeleton lines={4} label={label} />
          <PaneSkeleton lines={5} tall />
        </div>
        <PaneSkeleton lines={6} className="min-w-0" />
      </div>
    </div>
  );
}
