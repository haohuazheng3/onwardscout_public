import { and, count, desc, eq, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { getTranslations } from "next-intl/server";
import { AdminSearch, SubmitButton } from "@/components/admin/AdminClient";
import { AdminTable, AdminTitle, FilterPills, Mono, StatusTag, fmtDay, fmtInt, type Column } from "@/components/admin/AdminUi";
import { ButtonLink, Tag } from "@/components/ui";
import { Link } from "@/i18n/navigation";
import { isOpportunityTypeId, opportunityTypeLabel } from "@/lib/core";
import { db } from "@/lib/db";
import { opportunities, sources } from "@/lib/db/schema";
import { reviewOpportunityAction } from "../actions";
import { ADMIN_PAGE, adminLocale, backQuery, one, type LocaleParams, type SearchParams, requireAdminOnce } from "../_lib/data";
import { AdminNotice } from "../_lib/notice";

export const dynamic = "force-dynamic";

const TABS = ["review", "active", "expired", "rejected"] as const;
type TabId = (typeof TABS)[number];

const Query = z.object({ tab: z.enum(TABS).default("review"), q: z.string().trim().max(120).optional() });

const reviewWhere: SQL = or(
  eq(opportunities.status, "unverified"),
  and(eq(sources.kind, "user"), isNull(opportunities.verifiedAt), ne(opportunities.status, "rejected"), ne(opportunities.status, "expired")),
)!;

function tabWhere(tab: TabId): SQL {
  if (tab === "review") return reviewWhere;
  return eq(opportunities.status, tab);
}

interface Row {
  id: string;
  name: string;
  orgName: string | null;
  type: string;
  deadline: Date | null;
  rolling: boolean;
  status: string;
  public: boolean;
  url: string | null;
  sourceKind: string | null;
  sourceName: string | null;
}

export default async function AdminOpportunitiesPage({ params, searchParams }: { params: LocaleParams; searchParams: SearchParams }) {
  const locale = await adminLocale(params);
  await requireAdminOnce();
  const sp = await searchParams;
  const parsed = Query.safeParse({ tab: one(sp.tab), q: one(sp.q) });
  const { tab, q } = parsed.success ? parsed.data : { tab: "review" as TabId, q: undefined };
  const [t, tc] = await Promise.all([getTranslations({ locale, namespace: "admin.opportunities" }), getTranslations({ locale, namespace: "admin.common" })]);

  const search = q ? sql`${opportunities.search} @@ websearch_to_tsquery('simple', ${q})` : undefined;
  const [rows, counts] = await Promise.all([
    db
      .select({
        id: opportunities.id,
        name: opportunities.name,
        orgName: opportunities.orgName,
        type: opportunities.type,
        deadline: opportunities.deadline,
        rolling: opportunities.rolling,
        status: opportunities.status,
        public: opportunities.public,
        url: opportunities.url,
        sourceKind: sources.kind,
        sourceName: sources.name,
      })
      .from(opportunities)
      .leftJoin(sources, eq(sources.id, opportunities.sourceId))
      .where(and(tabWhere(tab), search))
      .orderBy(desc(opportunities.updatedAt))
      .limit(ADMIN_PAGE),
    Promise.all(
      TABS.map((id) =>
        db
          .select({ n: count() })
          .from(opportunities)
          .leftJoin(sources, eq(sources.id, opportunities.sourceId))
          .where(tabWhere(id))
          .then((r) => [id, Number(r[0]?.n ?? 0)] as const),
      ),
    ),
  ]);
  const countOf = new Map(counts);
  const back = backQuery(sp, ["tab", "q"]);
  const path = "/admin/opportunities";

  const decide = (r: Row, decision: "approve" | "reject" | "expire", label: string, pending: string, variant: "primary" | "ghost" | "quiet") => (
    <form action={reviewOpportunityAction}>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="path" value={path} />
      <input type="hidden" name="back" value={back} />
      <input type="hidden" name="id" value={r.id} />
      <input type="hidden" name="decision" value={decision} />
      <SubmitButton variant={variant} pendingLabel={pending}>
        {label}
      </SubmitButton>
    </form>
  );

  const columns: Column<Row>[] = [
    {
      key: "name",
      label: t("title"),
      primary: true,
      render: (r) => (
        <div className="min-w-0">
          <Link href={`/admin/opportunities/${r.id}`} prefetch={false} className="break-words font-semibold text-ink underline-offset-2 hover:underline">
            {r.name}
          </Link>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[0.8rem] text-ink-4">
            {r.orgName ? <span>{r.orgName}</span> : null}
            {r.url ? (
              <a href={r.url} target="_blank" rel="noopener noreferrer" className="break-all underline underline-offset-2">
                {r.url.replace(/^https?:\/\//, "").slice(0, 60)}
              </a>
            ) : null}
          </p>
        </div>
      ),
    },
    { key: "type", label: t("type"), render: (r) => (isOpportunityTypeId(r.type) ? opportunityTypeLabel(r.type, locale) : <Mono>{r.type}</Mono>) },
    {
      key: "deadline",
      label: t("deadline"),
      render: (r) => (r.rolling ? <Tag tone="pine">{t("rolling")}</Tag> : r.deadline ? fmtDay(r.deadline, locale) : <span className="text-ink-4">{t("noDeadline")}</span>),
    },
    {
      key: "status",
      label: tc("status"),
      render: (r) => (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <StatusTag status={r.status} />
          <Tag tone={r.public ? "ok" : "default"}>{r.public ? t("public") : t("private")}</Tag>
        </span>
      ),
    },
    { key: "source", label: t("source"), render: (r) => (r.sourceKind ? `${r.sourceKind}${r.sourceName ? ` · ${r.sourceName}` : ""}` : "—") },
    {
      key: "actions",
      label: "",
      actions: true,
      render: (r) => (
        <div className="flex flex-wrap gap-2">
          {r.status !== "active" || tab === "review" ? decide(r, "approve", t("approve"), t("approving"), "primary") : null}
          {r.status !== "rejected" ? decide(r, "reject", t("reject"), t("rejecting"), "ghost") : null}
          {r.status === "active" ? decide(r, "expire", t("expire"), t("expiring"), "quiet") : null}
          <ButtonLink href={`/admin/opportunities/${r.id}`} variant="quiet" size="sm" prefetch={false}>
            {t("edit")}
          </ButtonLink>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <AdminTitle title={t("title")} count={fmtInt(rows.length, locale)} lede={t("lede")} />
      <AdminNotice sp={sp} locale={locale} />
      <FilterPills
        label={t("title")}
        items={TABS.map((id) => ({
          href: `/admin/opportunities?tab=${id}${q ? `&q=${encodeURIComponent(q)}` : ""}`,
          label: t(`tabs.${id}`),
          active: tab === id,
          count: countOf.get(id) ?? 0,
        }))}
      />
      <AdminSearch
        path="/admin/opportunities"
        defaultValue={q ?? ""}
        keep={{ tab }}
        label={t("searchLabel")}
        placeholder={t("searchPlaceholder")}
        submitLabel={tc("search")}
        clearLabel={tc("clear")}
      />
      <AdminTable columns={columns} rows={rows} keyOf={(r) => r.id} empty={tab === "review" && !q ? t("emptyReview") : t("empty")} />
      {rows.length === ADMIN_PAGE ? <p className="text-[0.85rem] text-ink-4">{tc("showingNewest", { count: ADMIN_PAGE })}</p> : null}
    </div>
  );
}
