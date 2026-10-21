import { PaneSkeleton } from "@/components/Skeletons";

export default function Loading() {
  return (
    <div className="space-y-4" aria-busy="true">
      <span className="skeleton block h-9 w-48 rounded-[12px]" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <PaneSkeleton key={i} lines={2} label={i === 0 ? "Loading" : undefined} />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <PaneSkeleton lines={8} />
        <PaneSkeleton lines={6} />
      </div>
    </div>
  );
}
