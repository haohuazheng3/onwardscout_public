import { CardGridSkeleton, PaneSkeleton } from "@/components/Skeletons";
import { Skeleton } from "@/components/ui";

/** The board's shape: header, the goal/status pane, view + search + chips, then card panes. */
export default function ScoutLoading() {
  return (
    <div className="min-w-0" aria-busy="true">
      <div className="pb-6 sm:pb-8">
        <Skeleton className="block h-3 w-24 rounded-full" />
        <Skeleton className="mt-3 block h-9 w-2/3 max-w-[420px] rounded-[12px]" />
        <Skeleton className="mt-3 block h-3.5 w-80 max-w-full rounded-full" />
      </div>
      <div className="grid gap-4 sm:gap-5">
        <PaneSkeleton lines={1} label="Loading" />
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="flex gap-1.5">
            <Skeleton className="block h-9 w-16 rounded-full" />
            <Skeleton className="block h-9 w-28 rounded-full" />
            <Skeleton className="block h-9 w-24 rounded-full" />
          </div>
          <Skeleton className="block h-12 flex-1 rounded-[16px]" />
        </div>
        <div className="flex gap-2 overflow-hidden">
          {[56, 64, 132, 120, 88, 76, 150].map((w, i) => (
            <Skeleton key={i} className="block h-9 shrink-0 rounded-full" width={w} />
          ))}
        </div>
        <CardGridSkeleton cards={4} className="lg:grid-cols-2" />
      </div>
    </div>
  );
}
