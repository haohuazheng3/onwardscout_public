import { PaneSkeleton } from "@/components/Skeletons";

/** /app/start while it loads: the step bar, the drop zone and the links pane. */
export default function StartLoading() {
  return (
    <div className="mx-auto max-w-[760px]" aria-busy="true" role="status" aria-label="Loading">
      <div className="mb-6 grid grid-cols-3 gap-2" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <div key={i}>
            <span className="skeleton block h-1.5 w-full rounded-full" />
            <span className="skeleton mt-2 block h-3 w-20 rounded-full" />
          </div>
        ))}
      </div>
      <span className="skeleton block h-9 w-2/3 max-w-[420px] rounded-[12px]" aria-hidden="true" />
      <span className="skeleton mt-3 block h-4 w-80 max-w-full rounded-full" aria-hidden="true" />
      <div className="pane mt-6 p-4 sm:p-6" aria-hidden="true">
        <span className="skeleton block h-[220px] w-full rounded-[22px] sm:h-[260px]" />
      </div>
      <PaneSkeleton lines={2} className="mt-4" />
    </div>
  );
}
