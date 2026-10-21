import { BoardSkeleton } from "@/components/Skeletons";
import { Skeleton } from "@/components/ui";

/** The board's shape: header, goal chips, then lanes (one list on phones). */
export default function ApplicationsLoading() {
  return (
    <div className="min-w-0" aria-busy="true">
      <div className="pb-6 sm:pb-8">
        <Skeleton className="block h-3 w-24 rounded-full" />
        <Skeleton className="mt-3 block h-9 w-2/3 max-w-[420px] rounded-[12px]" />
        <Skeleton className="mt-3 block h-3.5 w-80 max-w-full rounded-full" />
      </div>
      <div className="flex gap-2 overflow-hidden">
        {[92, 120, 104, 136].map((w, i) => (
          <Skeleton key={i} className="block h-10 shrink-0 rounded-full" width={w} />
        ))}
      </div>
      <Skeleton className="mt-4 block h-3.5 w-64 max-w-full rounded-full" />
      <BoardSkeleton columns={4} className="mt-5" label="Loading" />
    </div>
  );
}
