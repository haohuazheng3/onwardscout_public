import { and, count, desc, eq, type SQL } from "drizzle-orm";
import { z } from "zod";
import { getTranslations } from "next-intl/server";
import { AdminPager, AdminTable, AdminTitle, FilterPills, Mono, StatusTag, UserLink, ago, fmtDate, fmtInt, type Column } from "@/components/admin/AdminUi";
import { Link } from "@/i18n/navigation";
import { APPLICATION_STATUSES, CHANNEL_IDS, type ApplicationStatus, type ChannelId } from "@/lib/core";
import { db } from "@/lib/db";
import { applications, opportunities } from "@/lib/db/schema";
import { pageHref, pageRows, pageWindow, adminLocale, emailsForUsers, one, type LocaleParams, type SearchParams, requireAdminOnce } from "../_lib/data";

export const dynamic = "force-dynamic";

const Query = z.object({
  status: z.enum(APPLICATION_STATUSES).optional(),
  channel: z.enum(CHANNEL_IDS).optional(),
  kind: z.enum(["real", "practice"]).optional(),
  user: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional(),
});

interface Row {
  id: string;
  userId: string;
  status: ApplicationStatus;
  channel: ChannelId;
  practice: boolean;
  needsYouReason: string | null;
  submittedAt: Date | null;
  updatedAt: Date;
  oppName: string | null;
  oppType: string | null;
}

function href(base: Record<string, string | undefined>, patch: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...base, ...patch })) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `/admin/applications?${s}` : "/admin/applications";
}

export default async function AdminApplicationsPage({ params, searchParams }: { params: LocaleParams; searchParams: SearchParams }) {
  const locale = await adminLocale(params);
  await requireAdminOnce();
  const sp = await searchParams;
  const parsed = Query.safeParse({ status: one(sp.status), channel: one(sp.channel), kind: one(sp.kind), user: one(sp.user) });
  const f = parsed.success ? parsed.data : {};
  const [t, tc] = await Promise.all([getTranslations({ locale, namespace: "admin.applications" }), getTranslations({ locale, namespace: "admin.common" })]);

  const conds: SQL[] = [];
  if (f.status) conds.push(eq(applications.status, f.status));
  if (f.channel) conds.push(eq(applications.channel, f.channel));
  if (f.kind) conds.push(eq(applications.practice, f.kind === "practice"));
  if (f.user) conds.push(eq(applications.userId, f.user));
  const where = conds.length ? and(...conds) : undefined;

  const win = pageWindow(sp);
  const [fetched, statusCounts] = await Promise.all([
    db
      .select({
        id: applications.id,
        userId: applications.userId,
        status: applications.status,
        channel: applications.channel,
        practice: applications.practice,
        needsYouReason: applications.needsYouReason,
        submittedAt: applications.submittedAt,
        updatedAt: applications.updatedAt,
        oppName: opportunities.name,
        oppType: opportunities.type,
      })
      .from(applications)
      .leftJoin(opportunities, eq(opportunities.id, applications.opportunityId))
      .where(where)
      .orderBy(desc(applications.updatedAt))
      .limit(win.limit)
      .offset(win.offset),
    db.select({ status: applications.status, n: count() }).from(applications).groupBy(applications.status),
  ]);
  const { rows, hasNext } = pageRows(fetched);
  const emails = await emailsForUsers(rows.map((r) => r.userId));
  const counts = new Map(statusCounts.map((r) => [r.status, Number(r.n)]));
  const base = { status: f.status, channel: f.channel, kind: f.kind, user: f.user };

  const columns: Column<Row>[] = [
    {
      key: "opp",
      label: t("opportunity"),
      primary: true,
      render: (r) => (
        <div className="min-w-0">
          <Link href={`/admin/applications/${r.id}`} prefetch={false} className="break-words font-semibold text-ink underline-offset-2 hover:underline">
            {r.oppName ?? r.id}
          </Link>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[0.78rem] text-ink-4">
            <Mono title={r.id}>{r.id}</Mono>
            {r.oppType ? <span>{r.oppType}</span> : null}
            {r.practice ? <span>· {tc("practice")}</span> : null}
          </p>
          {r.needsYouReason ? <p className="mt-1 text-[0.82rem] text-accent-text">{t("needsYou", { reason: r.needsYouReason })}</p> : null}
        </div>
      ),
    },
    { key: "user", label: tc("user"), render: (r) => <UserLink id={r.userId} email={emails.get(r.userId)} /> },
    { key: "channel", label: t("channel"), render: (r) => <Mono>{r.channel}</Mono> },
    { key: "status", label: tc("status"), render: (r) => <StatusTag status={r.status} /> },
    { key: "submitted", label: t("submitted"), render: (r) => (r.submittedAt ? <span title={fmtDate(r.submittedAt, locale)}>{ago(r.submittedAt, locale)}</span> : "—") },
    { key: "updated", label: tc("updated"), render: (r) => <span title={fmtDate(r.updatedAt, locale)}>{ago(r.updatedAt, locale)}</span> },
  ];

  return (
    <div className="space-y-5">
      <AdminTitle title={t("title")} count={fmtInt(rows.length, locale)} lede={t("lede")} />
      <div className="space-y-2">
        <FilterPills
          label={t("statusFilter")}
          items={[
            { href: href(base, { status: undefined }), label: tc("all"), active: !f.status },
            ...APPLICATION_STATUSES.filter((s) => (counts.get(s) ?? 0) > 0 || s === f.status).map((s) => ({
              href: href(base, { status: s }),
              label: s.replace(/_/g, " "),
              active: f.status === s,
              count: counts.get(s) ?? 0,
            })),
          ]}
        />
        <FilterPills
          label={t("channelFilter")}
          items={[
            { href: href(base, { channel: undefined }), label: tc("all"), active: !f.channel },
            ...CHANNEL_IDS.map((c) => ({ href: href(base, { channel: c }), label: c, active: f.channel === c })),
          ]}
        />
        <FilterPills
          label={t("kindFilter")}
          items={[
            { href: href(base, { kind: undefined }), label: tc("all"), active: !f.kind },
            { href: href(base, { kind: "real" }), label: t("real"), active: f.kind === "real" },
            { href: href(base, { kind: "practice" }), label: t("practiceOnly"), active: f.kind === "practice" },
          ]}
        />
      </div>
      <AdminTable columns={columns} rows={rows} keyOf={(r) => r.id} empty={t("empty")} />
      <AdminPager page={win.page} hasNext={hasNext} href={(n) => pageHref("/admin/applications", sp, n)} labels={{ prev: tc("prevPage"), next: tc("nextPage"), page: tc("pageN", { page: win.page }) }} />
    </div>
  );
}
