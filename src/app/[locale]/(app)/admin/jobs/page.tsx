import { and, count, desc, eq, type SQL } from "drizzle-orm";
import { z } from "zod";
import { getTranslations } from "next-intl/server";
import { SubmitButton } from "@/components/admin/AdminClient";
import { AdminPager, AdminTable, AdminTitle, FilterPills, Mono, StatusTag, UserLink, ago, fmtDate, fmtInt, type Column } from "@/components/admin/AdminUi";
import { JOB_STATUSES } from "@/lib/core";
import { db } from "@/lib/db";
import { jobs, type JobRow } from "@/lib/db/schema";
import { JOB_KINDS } from "@/lib/jobs/registry";
import { cancelJobAction, retryJobAction } from "../actions";
import { pageHref, pageRows, pageWindow, adminLocale, appStateEntries, backQuery, CRON_STATE_KEYS, emailsForUsers, one, type LocaleParams, type SearchParams, requireAdminOnce } from "../_lib/data";
import { AdminNotice } from "../_lib/notice";

export const dynamic = "force-dynamic";

const Query = z.object({
  status: z.enum(JOB_STATUSES).optional(),
  kind: z.string().regex(/^[a-z][a-z0-9_.-]{1,60}$/).optional(),
  user: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional(),
});

interface DrainSummary {
  ranAt?: string;
  claimed?: number;
  done?: number;
  failed?: number;
  retried?: number;
}

function href(base: Record<string, string | undefined>, patch: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...base, ...patch })) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `/admin/jobs?${s}` : "/admin/jobs";
}

export default async function AdminJobsPage({ params, searchParams }: { params: LocaleParams; searchParams: SearchParams }) {
  const locale = await adminLocale(params);
  await requireAdminOnce();
  const sp = await searchParams;
  const parsed = Query.safeParse({ status: one(sp.status), kind: one(sp.kind), user: one(sp.user) });
  const f = parsed.success ? parsed.data : {};
  const [t, tc] = await Promise.all([getTranslations({ locale, namespace: "admin.jobs" }), getTranslations({ locale, namespace: "admin.common" })]);

  const conds: SQL[] = [];
  if (f.status) conds.push(eq(jobs.status, f.status));
  if (f.kind) conds.push(eq(jobs.kind, f.kind));
  if (f.user) conds.push(eq(jobs.userId, f.user));
  const win = pageWindow(sp);
  const [fetched, byStatus, state] = await Promise.all([
    db
      .select()
      .from(jobs)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(jobs.updatedAt))
      .limit(win.limit)
      .offset(win.offset),
    db.select({ status: jobs.status, n: count() }).from(jobs).groupBy(jobs.status),
    appStateEntries([CRON_STATE_KEYS.jobs]),
  ]);
  const { rows, hasNext } = pageRows(fetched);
  const emails = await emailsForUsers(rows.map((r) => r.userId));
  const counts = new Map(byStatus.map((r) => [r.status, Number(r.n)]));
  const drain = state.get(CRON_STATE_KEYS.jobs)?.value as DrainSummary | undefined;
  const base = { status: f.status, kind: f.kind, user: f.user };
  const back = backQuery(sp, ["status", "kind", "user"]);
  const path = "/admin/jobs";

  const lever = (j: JobRow) => {
    const retry = j.status === "failed" || j.status === "cancelled";
    const stop = j.status === "queued" || j.status === "running";
    if (!retry && !stop) return null;
    return (
      <form action={retry ? retryJobAction : cancelJobAction}>
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="path" value={path} />
        <input type="hidden" name="back" value={back} />
        <input type="hidden" name="id" value={j.id} />
        <SubmitButton variant={retry ? "primary" : "quiet"} pendingLabel={retry ? t("retrying") : t("cancelling")}>
          {retry ? t("retry") : t("cancel")}
        </SubmitButton>
      </form>
    );
  };

  const columns: Column<JobRow>[] = [
    {
      key: "job",
      label: t("kind"),
      primary: true,
      render: (j) => (
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2">
            <Mono title={j.id}>{j.kind}</Mono>
            <StatusTag status={j.status} />
          </p>
          <p className="mt-1 text-[0.78rem] text-ink-4">
            <Mono>{j.id}</Mono>
            {j.dedupeKey ? <span className="break-all"> · {j.dedupeKey}</span> : null}
          </p>
          {j.error ? <p className="mt-1 break-words text-[0.82rem] text-bad">{j.error.slice(0, 400)}</p> : null}
        </div>
      ),
    },
    { key: "user", label: tc("user"), render: (j) => <UserLink id={j.userId} email={j.userId ? emails.get(j.userId) : null} /> },
    { key: "attempts", label: t("attempts"), render: (j) => <span className="num">{`${j.attempts} / ${j.maxAttempts}`}</span> },
    { key: "runAfter", label: t("runAfter"), render: (j) => <span title={fmtDate(j.runAfter, locale)}>{ago(j.runAfter, locale)}</span> },
    { key: "updated", label: tc("updated"), render: (j) => <span title={fmtDate(j.updatedAt, locale)}>{ago(j.updatedAt, locale)}</span> },
    { key: "actions", label: "", actions: true, render: lever },
  ];

  return (
    <div className="space-y-5">
      <AdminTitle title={t("title")} count={fmtInt(rows.length, locale)} lede={t("lede")} />
      <AdminNotice sp={sp} locale={locale} />
      <p className="text-[0.88rem] text-ink-3">
        {drain?.ranAt
          ? t("lastDrain", { when: ago(drain.ranAt, locale), claimed: drain.claimed ?? 0, done: drain.done ?? 0, failed: drain.failed ?? 0, retried: drain.retried ?? 0 })
          : t("noDrain")}
      </p>
      <div className="space-y-2">
        <FilterPills
          label={tc("status")}
          items={[
            { href: href(base, { status: undefined }), label: tc("all"), active: !f.status },
            ...JOB_STATUSES.map((s) => ({ href: href(base, { status: s }), label: s, active: f.status === s, count: counts.get(s) ?? 0 })),
          ]}
        />
        <FilterPills
          label={t("kind")}
          items={[
            { href: href(base, { kind: undefined }), label: tc("all"), active: !f.kind },
            ...JOB_KINDS.map((k) => ({ href: href(base, { kind: k }), label: k, active: f.kind === k })),
          ]}
        />
      </div>
      <AdminTable columns={columns} rows={rows} keyOf={(j) => j.id} empty={t("empty")} />
      <AdminPager page={win.page} hasNext={hasNext} href={(n) => pageHref("/admin/jobs", sp, n)} labels={{ prev: tc("prevPage"), next: tc("nextPage"), page: tc("pageN", { page: win.page }) }} />
    </div>
  );
}
