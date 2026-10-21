import { ListSkeleton, PaneSkeleton, StatsSkeleton } from "@/components/Skeletons";
import { Skeleton } from "@/components/ui";

/** Billing in its own shape: header, three stats, plan + packs on the left, orders + rules on the right. */
export default function BillingLoading() {
  return (
    <div className="min-w-0" aria-busy="true" aria-live="polite">
      <div className="pb-6 sm:pb-8">
        <Skeleton className="h-3 w-20 rounded-full" />
        <Skeleton className="mt-3 h-9 w-2/3 max-w-[380px] rounded-[12px]" />
        <Skeleton className="mt-3 h-3.5 w-96 max-w-full rounded-full" />
      </div>
      <StatsSkeleton count={3} />
      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] [&>*]:min-w-0">
        <div className="space-y-4">
          <PaneSkeleton lines={5} tall />
          <PaneSkeleton lines={3} />
          <ListSkeleton rows={3} />
        </div>
        <div className="space-y-4">
          <ListSkeleton rows={3} />
          <PaneSkeleton lines={5} />
        </div>
      </div>
    </div>
  );
}
