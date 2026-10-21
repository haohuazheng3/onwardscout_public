import { and, count, eq, gte, inArray, isNull, sql, sum } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { AdminTitle, Section, StatusTag, ago, fmtCents, fmtInt, fmtMoney } from "@/components/admin/AdminUi";
import { StatPane, Tag } from "@/components/ui";
import { Link } from "@/i18n/navigation";
import { APPLICATION_STATUSES } from "@/lib/core";
import { db } from "@/lib/db";
import { applications, contactMessages, errorGroups, jobs, llmCalls, orders, profiles, users } from "@/lib/db/schema";
import { features, missingEnv, stripeKeyMode, VERCEL_ENV } from "@/lib/env";
import { adminLocale, appStateEntries, CRON_STATE_KEYS, lastRunOf, type LocaleParams, requireAdminOnce } from "./_lib/data";

export const dynamic = "force-dynamic";

const n = (rows: { n: number | string | null }[]) => Number(rows[0]?.n ?? 0);

export default async function AdminOverview({ params }: { params: LocaleParams }) {
  const locale = await adminLocale(params);
  await requireAdminOnce();
  const t = await getTranslations({ locale, namespace: "admin.overview" });

  const [usersTotal, usersNew, activeProfiles, byStatus, submitted7d, revenue, errs, warns, queued, running, failed24h, llm, newMessages, crons] = await Promise.all([
    db.select({ n: count() }).from(users),
    db.select({ n: count() }).from(users).where(gte(users.createdAt, sql`now() - interval '7 days'`)),
    db.select({ n: count() }).from(profiles).where(inArray(profiles.status, ["draft", "confirmed"])),
    db.select({ status: applications.status, n: count() }).from(applications).where(eq(applications.practice, false)).groupBy(applications.status),
    db.select({ n: count() }).from(applications).where(and(eq(applications.practice, false), gte(applications.submittedAt, sql`now() - interval '7 days'`))),
    db
      .select({ currency: orders.currency, cents: sum(orders.amountTotal), n: count() })
      .from(orders)
      .where(and(eq(orders.status, "paid"), gte(orders.createdAt, sql`now() - interval '30 days'`)))
      .groupBy(orders.currency),
    db.select({ n: count() }).from(errorGroups).where(and(isNull(errorGroups.resolvedAt), eq(errorGroups.severity, "error"))),
    db.select({ n: count() }).from(errorGroups).where(and(isNull(errorGroups.resolvedAt), eq(errorGroups.severity, "warn"))),
    db.select({ n: count() }).from(jobs).where(eq(jobs.status, "queued")),
    db.select({ n: count() }).from(jobs).where(eq(jobs.status, "running")),
    db.select({ n: count() }).from(jobs).where(and(eq(jobs.status, "failed"), gte(jobs.updatedAt, sql`now() - interval '24 hours'`))),
    db
      .select({ cents: sql<number>`coalesce(sum(${llmCalls.costCents}), 0)::float8`, n: count() })
      .from(llmCalls)
      .where(gte(llmCalls.createdAt, sql`now() - interval '7 days'`)),
    db.select({ n: count() }).from(contactMessages).where(eq(contactMessages.status, "new")),
    appStateEntries(Object.values(CRON_STATE_KEYS)),
  ]);

  const statusCounts = new Map(byStatus.map((r) => [r.status, Number(r.n)]));
  const usd = revenue.find((r) => r.currency === "usd");
  const otherCurrencies = revenue.filter((r) => r.currency !== "usd");
  const paidCount = revenue.reduce((s, r) => s + Number(r.n), 0);
  const f = features();
  const missing = missingEnv();
  const mode = stripeKeyMode();

  const cronRows: { key: keyof typeof CRON_STATE_KEYS; label: string }[] = [
    { key: "jobs", label: t("cronJobs") },
    { key: "digest", label: t("cronDigest") },
    { key: "followups", label: t("cronFollowups") },
    { key: "expire", label: t("cronExpire") },
    { key: "sources", label: t("cronSources") },
    { key: "reconcile", label: t("cronReconcile") },
  ];

  return (
    <div className="space-y-6">
      <AdminTitle title={t("title")} lede={t("lede")} />

      <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 md:grid-cols-4 [&>*]:min-w-0">
        <StatPane label={t("users")} value={fmtInt(n(usersTotal), locale)} hint={t("usersHint", { count: fmtInt(n(usersNew), locale) })} href="/admin/users" />
        <StatPane label={t("profiles")} value={fmtInt(n(activeProfiles), locale)} hint={t("profilesHint")} />
        <StatPane label={t("submissions")} value={fmtInt(n(submitted7d), locale)} hint={t("submissionsHint")} tone="pine" href="/admin/applications?status=submitted" />
        <StatPane
          label={t("revenue")}
          value={fmtMoney(Number(usd?.cents ?? 0), "usd", locale)}
          hint={
            t("revenueHint", { count: paidCount }) +
            (otherCurrencies.length ? ` · ${otherCurrencies.map((r) => fmtMoney(Number(r.cents ?? 0), r.currency, locale)).join(" · ")}` : "")
          }
          href="/admin/orders"
        />
        <StatPane
          label={t("errors")}
          value={fmtInt(n(errs), locale)}
          hint={t("errorsHint", { count: n(warns) })}
          tone={n(errs) > 0 ? "accent" : "default"}
          href="/admin/errors"
        />
        <StatPane
          label={t("queue")}
          value={fmtInt(n(queued) + n(running), locale)}
          hint={t("queueHint", { running: fmtInt(n(running), locale), failed: fmtInt(n(failed24h), locale) })}
          tone={n(failed24h) > 0 ? "accent" : "default"}
          href="/admin/jobs"
        />
        <StatPane
          label={t("llmCost")}
          value={fmtCents(Number(llm[0]?.cents ?? 0), locale)}
          hint={t("llmCostHint", { calls: fmtInt(n(llm), locale), provider: f.llmProvider })}
          href="/admin/llm"
        />
        <StatPane label={t("messages")} value={fmtInt(n(newMessages), locale)} hint={t("messagesHint")} href="/admin/messages" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Section
          title={t("byStatus")}
          action={
            <Link href="/admin/applications" prefetch={false} className="text-[0.85rem] font-semibold text-accent-text">
              {t("allApplications")}
            </Link>
          }
        >
          <ul className="grid grid-cols-1 gap-x-6 min-[420px]:grid-cols-2 sm:grid-cols-3">
            {APPLICATION_STATUSES.map((s) => (
              <li key={s} className="flex items-baseline justify-between gap-2 border-b border-line py-2 text-[0.9rem]">
                <Link href={`/admin/applications?status=${s}`} prefetch={false} className="min-w-0 truncate text-ink-3 hover:text-ink">
                  {s.replace(/_/g, " ")}
                </Link>
                <span className="num font-semibold text-ink">{fmtInt(statusCounts.get(s) ?? 0, locale)}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section title={t("system")}>
          <ul className="space-y-2.5 text-[0.9rem] text-ink-2">
            <li className="flex items-center justify-between gap-3">
              <span className="text-ink-3">{t("deployment")}</span>
              <span className="flex items-center gap-2">
                <Tag>{VERCEL_ENV}</Tag>
                <code className="font-mono text-[0.8rem]">{(process.env.VERCEL_GIT_COMMIT_SHA ?? "local").slice(0, 10)}</code>
              </span>
            </li>
            <li className="flex items-center justify-between gap-3">
              <span className="text-ink-3">{t("provider")}</span>
              <Tag tone={f.llmProvider === "anthropic" ? "ok" : f.llmProvider === "local" ? "pine" : "warn"}>{f.llmProvider}</Tag>
            </li>
            <li className="flex items-center justify-between gap-3">
              <span className="text-ink-3">{t("stripe")}</span>
              <Tag tone={mode === "live" ? "ok" : mode === "test" ? "warn" : "bad"}>{mode}</Tag>
            </li>
            <li className="flex items-center justify-between gap-3">
              <span className="text-ink-3">{t("mailer")}</span>
              <Tag tone={f.mailer ? "ok" : "default"}>{f.mailer ? t("mailerOn") : t("mailerOff")}</Tag>
            </li>
            <li className="flex items-start justify-between gap-3">
              <span className="shrink-0 text-ink-3">{t("missingEnv")}</span>
              <span className="min-w-0 break-words text-right">{missing.length ? <span className="text-bad">{missing.join(", ")}</span> : <Tag tone="ok">0</Tag>}</span>
            </li>
          </ul>
          <p className="eyebrow mt-5">{t("crons")}</p>
          <ul className="mt-2 space-y-2 text-[0.88rem]">
            {cronRows.map((c) => {
              const entry = crons.get(CRON_STATE_KEYS[c.key]);
              const at = lastRunOf(entry);
              const err = (entry?.value as { error?: unknown; errors?: unknown[] } | null)?.errors?.length;
              return (
                <li key={c.key} className="flex items-center justify-between gap-3">
                  <span className="text-ink-3">{c.label}</span>
                  <span className="flex items-center gap-2">
                    {err ? <StatusTag status="failed" /> : null}
                    <span className={at ? "text-ink-2" : "text-ink-4"}>{at ? ago(at, locale) : "—"}</span>
                  </span>
                </li>
              );
            })}
          </ul>
          <div className="mt-4">
            <Link href="/admin/diagnostics" prefetch={false} className="btn btn-quiet btn-sm">
              {t("diagnostics")}
            </Link>
          </div>
        </Section>
      </div>
    </div>
  );
}
