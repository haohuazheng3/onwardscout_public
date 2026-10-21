import { PaneSkeleton } from "@/components/Skeletons";
import { Skeleton } from "@/components/ui";

/** The room's shape: back link, header pane with the trail, then the panes and the side action. */
export default function ApplicationRoomLoading() {
  return (
    <div className="min-w-0" aria-busy="true" aria-label="Loading">
      <Skeleton className="block h-4 w-32 rounded-full" />
      <div className="pane mt-4 p-5 sm:p-7">
        <Skeleton className="block h-3 w-40 rounded-full" />
        <Skeleton className="mt-4 block h-9 w-4/5 max-w-[560px] rounded-[12px]" />
        <div className="mt-4 flex flex-wrap gap-2">
          <Skeleton className="block h-6 w-44 rounded-full" />
          <Skeleton className="block h-6 w-28 rounded-full" />
        </div>
        <div className="mt-5 flex gap-2 overflow-hidden">
          {[88, 96, 104, 84, 96, 70].map((w, i) => (
            <Skeleton key={i} className="block h-8 shrink-0 rounded-full" width={w} />
          ))}
        </div>
      </div>
      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px] [&>*]:min-w-0">
        <div className="order-2 grid gap-4 lg:order-1">
          <PaneSkeleton lines={6} tall />
          <PaneSkeleton lines={3} />
        </div>
        <div className="order-1 grid gap-4 lg:order-2">
          <div className="pane p-5 sm:p-6">
            <Skeleton className="block h-5 w-40 rounded-full" />
            <Skeleton className="mt-3 block h-3.5 w-full rounded-full" />
            <Skeleton className="mt-5 block h-16 w-full rounded-[18px]" />
            <Skeleton className="mt-5 block h-14 w-full rounded-full" />
          </div>
        </div>
      </div>
    </div>
  );
}
