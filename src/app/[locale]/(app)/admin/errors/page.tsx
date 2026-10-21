import { asc, desc, sql } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { SubmitButton } from "@/components/admin/AdminClient";
import { AdminTitle, EmptyRow, Json, Mono, ago, fmtDate, fmtInt } from "@/components/admin/AdminUi";
import { DiagnosticsDrills } from "@/components/admin/DiagnosticsDrills";
import { Callout, Tag, cx } from "@/components/ui";
import { db } from "@/lib/db";
import { errorGroups } from "@/lib/db/schema";
import { HEALTH_SOURCES } from "@/lib/errors";
import { resolveAllErrorsAction, setErrorResolvedAction } from "../actions";
import { adminLocale, type LocaleParams, type SearchParams, requireAdminOnce } from "../_lib/data";
import { AdminNotice } from "../_lib/notice";

export const dynamic = "force-dynamic";

export default async function AdminErrorsPage({ params, searchParams }: { params: LocaleParams; searchParams: SearchParams }) {
  const locale = await adminLocale(params);
  await requireAdminOnce();
  const sp = await searchParams;
  const t = await getTranslations({ locale, namespace: "admin.errors" });
  // Open errors first, then open warnings, then resolved; newest activity first within each band.
  const rows = await db
    .select()
    .from(errorGroups)
    .orderBy(sql`${errorGroups.resolvedAt} is not null`, asc(sql`${errorGroups.severity} = 'warn'`), desc(errorGroups.lastSeen))
    .limit(200);
  const open = rows.filter((e) => !e.resolvedAt);
  const severe = open.filter((e) => e.severity === "error" && (HEALTH_SOURCES as readonly string[]).includes(e.source)).length;
  const path = "/admin/errors";

  return (
    <div className="space-y-5">
      <AdminTitle
        title={t("title")}
        count={fmtInt(open.length, locale)}
        lede={t("lede")}
        actions={
          open.length > 0 ? (
            <form action={resolveAllErrorsAction}>
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="path" value={path} />
              <SubmitButton>{t("resolveAll", { count: open.length })}</SubmitButton>
            </form>
          ) : null
        }
      />
      <AdminNotice sp={sp} locale={locale} />
      {severe > 0 ? <Callout tone="bad">{t("healthWarning", { count: severe })}</Callout> : null}

      <section className="space-y-3">
        <h2 className="eyebrow">{t("drillsTitle")}</h2>
        <DiagnosticsDrills include={["throw", "client", "resolve"]} />
      </section>

      {rows.length === 0 ? (
        <EmptyRow>{t("empty")}</EmptyRow>
      ) : (
        <ul className="space-y-3">
          {rows.map((e) => (
            <li key={e.id} className={cx("pane p-5", e.resolvedAt && "opacity-60")}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <Tag tone={e.severity === "error" ? "bad" : "warn"}>{e.severity}</Tag>
                    <Tag>{e.source}</Tag>
                    {e.resolvedAt ? <Tag tone="ok">{ago(e.resolvedAt, locale)}</Tag> : null}
                    <span className="text-[0.82rem] text-ink-4">
                      {t("seen", { count: fmtInt(e.count, locale), last: ago(e.lastSeen, locale), first: ago(e.firstSeen, locale) })}
                    </span>
                  </p>
                  <p className="mt-2 break-words font-semibold text-ink">
                    {e.name}: {e.message}
                  </p>
                  <p className="mt-1 break-all text-[0.82rem] text-ink-3">
                    {e.route ?? t("noRoute")} · {e.firstFrame ?? t("noFrame")}
                  </p>
                  <p className="mt-1 text-[0.76rem] text-ink-4">
                    {t("fingerprint")} <Mono title={fmtDate(e.firstSeen, locale)}>{e.fingerprint.slice(0, 12)}</Mono>
                  </p>
                  {e.stack || e.context ? (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-[0.82rem] text-ink-3">{t("stack")}</summary>
                      {e.context ? (
                        <div className="mt-2">
                          <Json value={e.context} max="max-h-40" />
                        </div>
                      ) : null}
                      {e.stack ? <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-pane-2 p-3 text-[0.75rem] text-ink-3">{e.stack}</pre> : null}
                    </details>
                  ) : null}
                </div>
                <form action={setErrorResolvedAction} className="shrink-0">
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="path" value={path} />
                  <input type="hidden" name="id" value={e.id} />
                  <input type="hidden" name="resolve" value={e.resolvedAt ? "0" : "1"} />
                  <SubmitButton variant={e.resolvedAt ? "quiet" : "primary"}>{e.resolvedAt ? t("reopen") : t("resolve")}</SubmitButton>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
