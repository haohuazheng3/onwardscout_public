import { and, count, desc, gte, inArray, sql, sum } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { AdminTable, AdminTitle, Mono, StatusTag, UserLink, ago, fmtDate, fmtInt, fmtMoney, type Column } from "@/components/admin/AdminUi";
import { StatPane, Tag } from "@/components/ui";
import { OFFERS, isSku } from "@/content/plans";
import { db } from "@/lib/db";
import { orders, subscriptions, type OrderRow, type SubscriptionRow } from "@/lib/db/schema";
import { ADMIN_PAGE, adminLocale, emailsForUsers, type LocaleParams, requireAdminOnce } from "../_lib/data";

export const dynamic = "force-dynamic";

export default async function AdminOrdersPage({ params }: { params: LocaleParams }) {
  const locale = await adminLocale(params);
  await requireAdminOnce();
  const [t, tc] = await Promise.all([getTranslations({ locale, namespace: "admin.orders" }), getTranslations({ locale, namespace: "admin.common" })]);

  const [rows, subs, last30] = await Promise.all([
    db.select().from(orders).orderBy(desc(orders.createdAt)).limit(ADMIN_PAGE),
    db.select().from(subscriptions).orderBy(desc(subscriptions.updatedAt)).limit(ADMIN_PAGE),
    db
      .select({ status: orders.status, currency: orders.currency, n: count(), cents: sum(orders.amountTotal) })
      .from(orders)
      .where(and(gte(orders.createdAt, sql`now() - interval '30 days'`), inArray(orders.status, ["paid", "refunded", "disputed"])))
      .groupBy(orders.status, orders.currency),
  ]);
  const emails = await emailsForUsers([...rows.map((o) => o.userId), ...subs.map((s) => s.userId)]);
  const paid = last30.filter((r) => r.status === "paid");
  const paidUsd = paid.find((r) => r.currency === "usd");
  const paidCount = paid.reduce((s, r) => s + Number(r.n), 0);
  const refunds = last30.filter((r) => r.status === "refunded").reduce((s, r) => s + Number(r.n), 0);
  const disputes = last30.filter((r) => r.status === "disputed").reduce((s, r) => s + Number(r.n), 0);
  const activeSubs = subs.filter((s) => ["active", "trialing", "past_due"].includes(s.status)).length;
  const skuName = (sku: string) => (isSku(sku) ? OFFERS[sku].name[locale] : sku);

  const orderColumns: Column<OrderRow>[] = [
    {
      key: "sku",
      label: t("sku"),
      primary: true,
      render: (o) => (
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-semibold text-ink">
            {skuName(o.sku)} · {fmtMoney(o.amountTotal, o.currency, locale)}
            <StatusTag status={o.status} />
          </p>
          <p className="mt-0.5 text-[0.78rem] text-ink-4">
            <Mono title={o.stripeSessionId}>{o.id}</Mono> · {o.kind}
          </p>
        </div>
      ),
    },
    { key: "user", label: tc("user"), render: (o) => <UserLink id={o.userId} email={o.email ?? emails.get(o.userId)} /> },
    { key: "promo", label: t("promo"), render: (o) => (o.promoCode ? <Tag tone="pine">{o.promoCode}</Tag> : "—") },
    { key: "source", label: t("source"), render: (o) => o.source },
    { key: "created", label: tc("created"), render: (o) => <span title={fmtDate(o.createdAt, locale)}>{ago(o.createdAt, locale)}</span> },
  ];

  const subColumns: Column<SubscriptionRow>[] = [
    {
      key: "sku",
      label: t("sku"),
      primary: true,
      render: (s) => (
        <p className="flex flex-wrap items-center gap-2 font-semibold text-ink">
          {skuName(s.sku)}
          <StatusTag status={s.status} />
          <Tag>{s.cancelAtPeriodEnd ? t("cancelsAtEnd") : t("renews")}</Tag>
        </p>
      ),
    },
    { key: "user", label: tc("user"), render: (s) => <UserLink id={s.userId} email={emails.get(s.userId)} /> },
    { key: "period", label: t("periodEnd"), render: (s) => fmtDate(s.currentPeriodEnd, locale) },
    { key: "id", label: "Stripe", render: (s) => <Mono>{s.stripeSubscriptionId}</Mono> },
  ];

  return (
    <div className="space-y-5">
      <AdminTitle title={t("title")} count={fmtInt(rows.length, locale)} lede={t("lede")} />
      <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-3 [&>*]:min-w-0">
        <StatPane label={t("revenue")} value={fmtMoney(Number(paidUsd?.cents ?? 0), "usd", locale)} hint={`${fmtInt(paidCount, locale)}`} />
        <StatPane label={t("refunds")} value={`${fmtInt(refunds, locale)} / ${fmtInt(disputes, locale)}`} tone={disputes > 0 ? "accent" : "default"} />
        <StatPane label={t("activeSubs")} value={fmtInt(activeSubs, locale)} tone="pine" />
      </div>
      <AdminTable columns={orderColumns} rows={rows} keyOf={(o) => o.id} empty={t("empty")} />
      <h2 className="title pt-2 text-[1.25rem] text-ink">{t("subscriptions")}</h2>
      <AdminTable columns={subColumns} rows={subs} keyOf={(s) => s.id} empty={t("emptySubs")} />
    </div>
  );
}
