import { asc, desc } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { SubmitButton } from "@/components/admin/AdminClient";
import { AdminTable, AdminTitle, Json, Mono, StatusTag, ago, fmtDate, fmtInt, type Column } from "@/components/admin/AdminUi";
import { Tag } from "@/components/ui";
import { db } from "@/lib/db";
import { sources, type SourceRow } from "@/lib/db/schema";
import { runAllSourcesAction, runSourceAction } from "../actions";
import { adminLocale, appStateEntries, CRON_STATE_KEYS, lastRunOf, type LocaleParams, type SearchParams, requireAdminOnce } from "../_lib/data";
import { AdminNotice } from "../_lib/notice";

export const dynamic = "force-dynamic";

const PAGE = 300;

export default async function AdminSourcesPage({ params, searchParams }: { params: LocaleParams; searchParams: SearchParams }) {
  const locale = await adminLocale(params);
  await requireAdminOnce();
  const sp = await searchParams;
  const [t, tc] = await Promise.all([getTranslations({ locale, namespace: "admin.sources" }), getTranslations({ locale, namespace: "admin.common" })]);
  const [rows, state] = await Promise.all([
    db.select().from(sources).orderBy(desc(sources.enabled), asc(sources.lastRunAt), asc(sources.name)).limit(PAGE),
    appStateEntries([CRON_STATE_KEYS.sources]),
  ]);
  const lastPass = state.get(CRON_STATE_KEYS.sources);
  const lastAt = lastRunOf(lastPass);
  const path = "/admin/sources";

  const columns: Column<SourceRow>[] = [
    {
      key: "name",
      label: t("title"),
      primary: true,
      render: (s) => (
        <div className="min-w-0">
          <p className="break-words font-semibold text-ink">{s.name}</p>
          <a href={s.url} target="_blank" rel="noopener noreferrer" className="break-all text-[0.8rem] text-ink-4 underline underline-offset-2">
            {s.url.replace(/^https?:\/\//, "").slice(0, 80)}
          </a>
        </div>
      ),
    },
    {
      key: "kind",
      label: t("kind"),
      render: (s) => (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <Mono>{s.kind}</Mono>
          <Tag tone={s.enabled ? "ok" : "default"}>{s.enabled ? t("enabled") : t("disabled")}</Tag>
        </span>
      ),
    },
    { key: "schedule", label: t("schedule"), render: (s) => s.schedule },
    {
      key: "last",
      label: t("lastRun"),
      render: (s) => (
        <span className="inline-flex flex-col items-end gap-1 sm:items-start">
          <span title={fmtDate(s.lastRunAt, locale)}>{s.lastRunAt ? ago(s.lastRunAt, locale) : tc("never")}</span>
          {s.lastStatus ? <StatusTag status={s.lastStatus} /> : null}
          {s.lastError ? <span className="max-w-[28ch] break-words text-[0.78rem] text-bad">{s.lastError.slice(0, 160)}</span> : null}
        </span>
      ),
    },
    { key: "count", label: t("count"), className: "sm:text-right", render: (s) => <span className="num">{s.lastCount === null ? "—" : fmtInt(s.lastCount, locale)}</span> },
    {
      key: "actions",
      label: "",
      actions: true,
      render: (s) => (
        <form action={runSourceAction}>
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="path" value={path} />
          <input type="hidden" name="id" value={s.id} />
          <SubmitButton pendingLabel={t("running")}>{t("runNow")}</SubmitButton>
        </form>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <AdminTitle
        title={t("title")}
        count={fmtInt(rows.length, locale)}
        lede={t("lede")}
        actions={
          <form action={runAllSourcesAction}>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="path" value={path} />
            <SubmitButton variant="primary" pendingLabel={t("running")}>
              {t("runAll")}
            </SubmitButton>
          </form>
        }
      />
      <AdminNotice sp={sp} locale={locale} />
      <div className="pane-inset px-4 py-3 text-[0.88rem] text-ink-3">
        {lastAt ? t("lastPass", { when: ago(lastAt, locale) }) : t("noPass")}
        {lastPass ? (
          <details className="mt-1">
            <summary className="cursor-pointer text-[0.8rem] text-ink-4">{CRON_STATE_KEYS.sources}</summary>
            <div className="mt-1.5">
              <Json value={lastPass.value} max="max-h-48" />
            </div>
          </details>
        ) : null}
      </div>
      <AdminTable columns={columns} rows={rows} keyOf={(s) => s.id} empty={t("empty")} />
    </div>
  );
}
