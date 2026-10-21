import { StatsSkeleton, PaneSkeleton } from "@/components/Skeletons";

/** Overview skeleton: title, two rows of stat panes, then the status and system panes. */
export default function AdminLoading() {
  return (
    <div aria-busy="true" aria-live="polite" className="min-w-0">
      <span className="skeleton block h-9 w-56 rounded-[12px]" />
      <span className="skeleton mt-3 block h-4 w-96 max-w-full rounded-full" />
      <StatsSkeleton count={4} className="mt-6 grid-cols-2 sm:grid-cols-4" />
      <StatsSkeleton count={4} className="mt-3 grid-cols-2 sm:grid-cols-4" />
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <PaneSkeleton lines={5} />
        <PaneSkeleton lines={5} />
      </div>
    </div>
  );
}
