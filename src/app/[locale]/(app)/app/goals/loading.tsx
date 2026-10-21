import { useTranslations } from "next-intl";
import { PaneSkeleton } from "@/components/Skeletons";

/** /app/goals while it loads: header and goal panes. */
export default function GoalsLoading() {
  // The skeleton is announced in the page language (the layout set the request locale).
  const label = useTranslations("common")("status.loading");
  return (
    <div className="min-w-0" aria-busy="true" role="status" aria-label={label}>
      <div className="pb-6 sm:pb-8" aria-hidden="true">
        <span className="skeleton block h-3 w-24 rounded-full" />
        <span className="skeleton mt-3 block h-9 w-2/3 max-w-[420px] rounded-[12px]" />
        <span className="skeleton mt-3 block h-3.5 w-80 max-w-full rounded-full" />
      </div>
      <div className="grid gap-4">
        <PaneSkeleton lines={5} tall />
        <PaneSkeleton lines={4} />
      </div>
    </div>
  );
}
