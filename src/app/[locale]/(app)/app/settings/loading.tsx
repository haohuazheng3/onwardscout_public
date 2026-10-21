import { FormSkeleton, PaneSkeleton } from "@/components/Skeletons";
import { Skeleton } from "@/components/ui";

/** Settings skeleton: header, the section chips, then the panes in the order they render. */
export default function SettingsLoading() {
  return (
    <div className="min-w-0" aria-busy="true">
      <div className="pb-6 sm:pb-8">
        <Skeleton className="block h-3 w-20 rounded-full" />
        <Skeleton className="mt-3 block h-9 w-2/3 max-w-[360px] rounded-[12px]" />
        <Skeleton className="mt-3 block h-3.5 w-80 max-w-full rounded-full" />
      </div>
      <div className="mb-5 flex gap-2 overflow-hidden">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="block h-9 w-28 shrink-0 rounded-full" />
        ))}
      </div>
      <div className="grid gap-4">
        <PaneSkeleton lines={2} label="Loading your settings" />
        <FormSkeleton fields={4} />
        <PaneSkeleton lines={3} />
        <PaneSkeleton lines={2} />
      </div>
    </div>
  );
}
