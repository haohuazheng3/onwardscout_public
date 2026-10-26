import { useTranslations } from "next-intl";

/** /app/start while it loads: the progress bar, the question and its answers (one question per screen). */
export default function StartLoading() {
  // The skeleton is announced in the page language (the layout set the request locale).
  const label = useTranslations("common")("status.loading");
  return (
    <div className="mx-auto max-w-[640px]" aria-busy="true" role="status" aria-label={label}>
      <div className="mb-6 flex items-center gap-3" aria-hidden="true">
        <span className="skeleton block h-1.5 min-w-0 flex-1 rounded-full" />
        <span className="skeleton block h-3 w-12 rounded-full" />
      </div>
      <span className="skeleton block h-9 w-2/3 max-w-[420px] rounded-[12px]" aria-hidden="true" />
      <span className="skeleton mt-3 block h-4 w-80 max-w-full rounded-full" aria-hidden="true" />
      <div className="mt-6 grid gap-2.5" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="pane flex items-center gap-3.5 px-4 py-3.5 sm:px-5 sm:py-4">
            <span className="skeleton block h-10 w-10 shrink-0 rounded-full" />
            <span className="skeleton block h-4 w-1/2 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
