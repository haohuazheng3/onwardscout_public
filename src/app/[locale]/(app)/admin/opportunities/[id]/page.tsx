import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { SubmitButton } from "@/components/admin/AdminClient";
import { AdminTitle, KeyValue, Mono, Section, StatusTag, fmtDate } from "@/components/admin/AdminUi";
import { Field, Input, Select, Textarea } from "@/components/ui";
import { Link } from "@/i18n/navigation";
import { OPPORTUNITY_STATUSES, OPPORTUNITY_TYPES, localize } from "@/lib/core";
import { db } from "@/lib/db";
import { opportunities, sources } from "@/lib/db/schema";
import { reviewOpportunityAction, updateOpportunityAction } from "../../actions";
import { adminLocale, requireAdminOnce } from "../../_lib/data";
import { AdminNotice } from "../../_lib/notice";

export const dynamic = "force-dynamic";

type Params = Promise<{ locale: string; id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function AdminOpportunityPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const locale = await adminLocale(params);
  await requireAdminOnce();
  const { id } = await params;
  if (!/^opp_[0-9a-z]{8,32}$/.test(id)) notFound();
  const sp = await searchParams;
  const found = await db
    .select({ opp: opportunities, sourceKind: sources.kind, sourceName: sources.name })
    .from(opportunities)
    .leftJoin(sources, eq(sources.id, opportunities.sourceId))
    .where(eq(opportunities.id, id))
    .limit(1);
  const row = found[0];
  if (!row) notFound();
  const o = row.opp;
  const [t, tl, tc] = await Promise.all([
    getTranslations({ locale, namespace: "admin.opportunity" }),
    getTranslations({ locale, namespace: "admin.opportunities" }),
    getTranslations({ locale, namespace: "admin.common" }),
  ]);
  const path = `/admin/opportunities/${id}`;
  const deadline = o.deadline ? new Date(o.deadline).toISOString().slice(0, 10) : "";
  const hidden = (
    <>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="path" value={path} />
      <input type="hidden" name="id" value={o.id} />
    </>
  );

  return (
    <div className="space-y-5">
      <AdminTitle
        title={t("title")}
        lede={
          <span className="flex flex-wrap items-center gap-2">
            <Mono>{o.id}</Mono>
            <StatusTag status={o.status} />
            <span>{t("lede")}</span>
          </span>
        }
        actions={
          <Link href="/admin/opportunities" prefetch={false} className="btn btn-quiet btn-sm">
            {tc("back")}
          </Link>
        }
      />
      <AdminNotice sp={sp} locale={locale} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <form action={updateOpportunityAction} className="pane space-y-4 p-5 sm:p-6">
          {hidden}
          <Field id="opp-name" label={t("name")}>
            <Input id="opp-name" name="name" defaultValue={o.name} required minLength={2} maxLength={300} />
          </Field>
          <Field id="opp-org" label={t("orgName")}>
            <Input id="opp-org" name="orgName" defaultValue={o.orgName ?? ""} maxLength={200} />
          </Field>
          <Field id="opp-url" label={t("url")}>
            <Input id="opp-url" name="url" type="url" defaultValue={o.url ?? ""} maxLength={2000} inputMode="url" />
          </Field>
          <Field id="opp-summary" label={t("summary")}>
            <Textarea id="opp-summary" name="summary" defaultValue={o.summary ?? ""} rows={4} maxLength={2000} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="opp-type" label={t("type")}>
              <Select id="opp-type" name="type" defaultValue={o.type}>
                {OPPORTUNITY_TYPES.map((ty) => (
                  <option key={ty.id} value={ty.id}>
                    {localize(ty.label, locale)} ({ty.id})
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="opp-status" label={t("status")}>
              <Select id="opp-status" name="status" defaultValue={o.status}>
                {OPPORTUNITY_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="opp-deadline" label={t("deadline")} hint={t("deadlineHint")}>
              <Input id="opp-deadline" name="deadline" type="date" defaultValue={deadline} aria-describedby="opp-deadline-hint" />
            </Field>
            <div className="flex flex-col justify-end gap-3 pb-1">
              <label className="flex min-h-[44px] items-center gap-3 text-[0.95rem] text-ink">
                <input type="checkbox" name="rolling" defaultChecked={o.rolling} className="h-5 w-5 accent-[var(--pine)]" />
                {t("rolling")}
              </label>
              <label className="flex min-h-[44px] items-center gap-3 text-[0.95rem] text-ink">
                <input type="checkbox" name="public" defaultChecked={o.public} className="h-5 w-5 accent-[var(--pine)]" />
                <span>
                  {t("public")}
                  <span className="block text-[0.8rem] text-ink-4">{t("publicHint")}</span>
                </span>
              </label>
            </div>
          </div>
          <SubmitButton variant="primary" size="md" pendingLabel={t("saving")}>
            {t("save")}
          </SubmitButton>
        </form>

        <div className="space-y-4">
          <Section title={tc("details")}>
            <KeyValue
              rows={[
                { label: t("slug"), value: <Mono>{o.slug}</Mono> },
                { label: tl("source"), value: row.sourceKind ? `${row.sourceKind}${row.sourceName ? ` · ${row.sourceName}` : ""}` : "—" },
                { label: t("sourceRef"), value: o.sourceRef ? <Mono>{o.sourceRef}</Mono> : "—" },
                { label: t("verifiedAt"), value: fmtDate(o.verifiedAt, locale) },
                { label: tc("created"), value: fmtDate(o.createdAt, locale) },
                { label: tc("updated"), value: fmtDate(o.updatedAt, locale) },
              ]}
            />
            <div className="mt-4 flex flex-wrap gap-2">
              {(["approve", "reject", "expire"] as const).map((d) => (
                <form key={d} action={reviewOpportunityAction}>
                  {hidden}
                  <input type="hidden" name="decision" value={d} />
                  <SubmitButton variant={d === "approve" ? "primary" : d === "reject" ? "ghost" : "quiet"} pendingLabel={tl(d === "approve" ? "approving" : d === "reject" ? "rejecting" : "expiring")}>
                    {tl(d)}
                  </SubmitButton>
                </form>
              ))}
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
