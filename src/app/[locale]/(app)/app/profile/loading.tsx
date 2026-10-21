import { useTranslations } from "next-intl";
import { ListSkeleton, PaneSkeleton } from "@/components/Skeletons";

/** /app/profile while it loads: header, completeness, the card, the record; sources on the side. */
export default function ProfileLoading() {
  // The skeleton is announced in the page language (the layout set the request locale).
  const label = useTranslations("common")("status.loading");
  return (
    <div className="min-w-0" aria-busy="true" role="status" aria-label={label}>
      <div className="pb-6 sm:pb-8" aria-hidden="true">
        <span className="skeleton block h-3 w-24 rounded-full" />
        <span className="skeleton mt-3 block h-9 w-2/3 max-w-[420px] rounded-[12px]" />
        <span className="skeleton mt-3 block h-3.5 w-80 max-w-full rounded-full" />
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] [&>*]:min-w-0">
        <div className="grid content-start gap-4">
          <PaneSkeleton lines={2} />
          <PaneSkeleton lines={4} tall />
          <ListSkeleton rows={3} />
        </div>
        <div className="grid content-start gap-4">
          <ListSkeleton rows={3} />
          <PaneSkeleton lines={3} />
        </div>
      </div>
    </div>
  );
}
