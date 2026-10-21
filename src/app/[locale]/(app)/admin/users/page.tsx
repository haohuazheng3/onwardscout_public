import { count, desc, eq, ilike, inArray, or } from "drizzle-orm";
import { z } from "zod";
import { getTranslations } from "next-intl/server";
import { AdminSearch } from "@/components/admin/AdminClient";
import { AdminTable, AdminTitle, Mono, StatusTag, ago, fmtDate, fmtInt, type Column } from "@/components/admin/AdminUi";
import { Link } from "@/i18n/navigation";
import { db } from "@/lib/db";
import { applications, profiles, users, type UserRow } from "@/lib/db/schema";
import { ADMIN_PAGE, adminLocale, availableCredits, likeEscape, one, type LocaleParams, type SearchParams, requireAdminOnce } from "../_lib/data";

export const dynamic = "force-dynamic";

const Query = z.object({ q: z.string().trim().max(120).optional() });

export default async function UsersPage({ params, searchParams }: { params: LocaleParams; searchParams: SearchParams }) {
  const locale = await adminLocale(params);
  await requireAdminOnce();
  const sp = await searchParams;
  const parsed = Query.safeParse({ q: one(sp.q) });
  const q = parsed.success ? (parsed.data.q ?? "") : "";
  const [t, tc] = await Promise.all([getTranslations({ locale, namespace: "admin.users" }), getTranslations({ locale, namespace: "admin.common" })]);

  const rows: UserRow[] = await db
    .select()
    .from(users)
    .where(q ? or(eq(users.id, q), ilike(users.email, `%${likeEscape(q)}%`)) : undefined)
    .orderBy(desc(users.createdAt))
    .limit(ADMIN_PAGE);
  const ids = rows.map((u) => u.id);
  const [profileRows, appCounts, credits] = await Promise.all([
    ids.length
      ? db.select({ userId: profiles.userId, status: profiles.status, completeness: profiles.completeness }).from(profiles).where(inArray(profiles.userId, ids))
      : Promise.resolve([]),
    ids.length
      ? db.select({ userId: applications.userId, n: count() }).from(applications).where(inArray(applications.userId, ids)).groupBy(applications.userId)
      : Promise.resolve([]),
    availableCredits(ids),
  ]);
  const profileOf = new Map(profileRows.map((p) => [p.userId, p]));
  const appsOf = new Map(appCounts.map((a) => [a.userId, Number(a.n)]));

  const columns: Column<UserRow>[] = [
    {
      key: "email",
      label: t("email"),
      primary: true,
      render: (u) => (
        <div className="min-w-0">
          <Link href={`/admin/users/${encodeURIComponent(u.id)}`} prefetch={false} className="break-all font-semibold text-ink underline-offset-2 hover:underline">
            {u.email}
          </Link>
          <p className="mt-0.5 text-[0.78rem] text-ink-4">
            <Mono title={u.id}>{u.id}</Mono> · {u.locale}
          </p>
        </div>
      ),
    },
    {
      key: "profile",
      label: t("profile"),
      render: (u) => {
        const p = profileOf.get(u.id);
        return p ? (
          <span className="inline-flex items-center gap-2">
            <StatusTag status={p.status} />
            <span className="num text-ink-3">{p.completeness}%</span>
          </span>
        ) : (
          <span className="text-ink-4">{t("noProfile")}</span>
        );
      },
    },
    { key: "apps", label: t("applications"), className: "sm:text-right", render: (u) => <span className="num">{fmtInt(appsOf.get(u.id) ?? 0, locale)}</span> },
    { key: "credits", label: t("credits"), className: "sm:text-right", render: (u) => <span className="num font-semibold">{fmtInt(credits.get(u.id) ?? 0, locale)}</span> },
    { key: "seen", label: t("seen"), render: (u) => <span title={fmtDate(u.lastSeenAt, locale)}>{ago(u.lastSeenAt, locale)}</span> },
    { key: "joined", label: t("joined"), render: (u) => <span title={fmtDate(u.createdAt, locale)}>{ago(u.createdAt, locale)}</span> },
  ];

  return (
    <div className="space-y-5">
      <AdminTitle title={t("title")} count={fmtInt(rows.length, locale)} lede={t("lede")} />
      <AdminSearch
        path="/admin/users"
        defaultValue={q}
        label={t("searchLabel")}
        placeholder={t("searchPlaceholder")}
        submitLabel={tc("search")}
        clearLabel={tc("clear")}
      />
      <AdminTable columns={columns} rows={rows} keyOf={(u) => u.id} empty={q ? t("emptySearch", { q }) : t("empty")} />
      {rows.length === ADMIN_PAGE ? <p className="text-[0.85rem] text-ink-4">{tc("showingNewest", { count: ADMIN_PAGE })}</p> : null}
    </div>
  );
}
