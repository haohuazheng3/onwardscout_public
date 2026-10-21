import { useTranslations } from "next-intl";
import { ListSkeleton } from "@/components/Skeletons";

/** /app/documents while it loads: sources and generated documents. */
export default function DocumentsLoading() {
  // The skeleton is announced in the page language (the layout set the request locale).
  const label = useTranslations("common")("status.loading");
  return (
    <div className="min-w-0" aria-busy="true" role="status" aria-label={label}>
      <div className="pb-6 sm:pb-8" aria-hidden="true">
        <span className="skeleton block h-3 w-24 rounded-full" />
        <span className="skeleton mt-3 block h-9 w-2/3 max-w-[420px] rounded-[12px]" />
        <span className="skeleton mt-3 block h-3.5 w-80 max-w-full rounded-full" />
      </div>
      <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        <ListSkeleton rows={4} />
        <ListSkeleton rows={3} />
      </div>
    </div>
  );
}
