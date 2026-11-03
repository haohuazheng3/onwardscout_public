import { useTranslations } from "next-intl";

/** /app/apply/<id> while it loads: the programme's heading, then the drop zone. */
export default function ApplyLoading() {
  const label = useTranslations("common")("status.loading");
  return (
    <div className="mx-auto max-w-[760px]" aria-busy="true" role="status" aria-label={label}>
      <span className="skeleton block h-4 w-40 rounded-full" aria-hidden="true" />
      <span className="skeleton mt-4 block h-10 w-3/4 max-w-[520px] rounded-[12px]" aria-hidden="true" />
      <span className="skeleton mt-3 block h-4 w-96 max-w-full rounded-full" aria-hidden="true" />
      <div className="pane mt-7 grid gap-4 p-6 sm:p-8" aria-hidden="true">
        <span className="skeleton block h-40 w-full rounded-[20px]" />
        <span className="skeleton block h-4 w-2/3 rounded-full" />
      </div>
    </div>
  );
}
