import { and, count, desc, eq, gte, sql } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { AdminTitle, KeyValue, Mono, Section, UserLink, ago, fmtCents, fmtDay, fmtInt } from "@/components/admin/AdminUi";
import { Tag } from "@/components/ui";
import { db } from "@/lib/db";
import { llmCalls } from "@/lib/db/schema";
import { env, features, llmUserMonthlyCents } from "@/lib/env";
import { adminLocale, emailsForUsers, type LocaleParams, requireAdminOnce } from "../_lib/data";

export const dynamic = "force-dynamic";

export default async function AdminLlmPage({ params }: { params: LocaleParams }) {
  const locale = await adminLocale(params);
  await requireAdminOnce();
  const t = await getTranslations({ locale, namespace: "admin.llm" });

  const [perDay, byPurpose, perUser, failures] = await Promise.all([
    db
      .select({
        day: sql<string>`to_char(date_trunc('day', ${llmCalls.createdAt} at time zone 'UTC'), 'YYYY-MM-DD')`,
        calls: count(),
        failed: sql<number>`count(*) filter (where not ${llmCalls.ok})::int`,
        cents: sql<number>`coalesce(sum(${llmCalls.costCents}), 0)::float8`,
        local: sql<number>`count(*) filter (where ${llmCalls.provider} = 'local')::int`,
      })
      .from(llmCalls)
      .where(gte(llmCalls.createdAt, sql`now() - interval '14 days'`))
      .groupBy(sql`1`)
      .orderBy(desc(sql`1`)),
    db
      .select({
        purpose: llmCalls.purpose,
        provider: llmCalls.provider,
        calls: count(),
        cents: sql<number>`coalesce(sum(${llmCalls.costCents}), 0)::float8`,
        ms: sql<number>`coalesce(avg(${llmCalls.ms}), 0)::int`,
      })
      .from(llmCalls)
      .where(gte(llmCalls.createdAt, sql`now() - interval '7 days'`))
      .groupBy(llmCalls.purpose, llmCalls.provider)
      .orderBy(desc(sql`count(*)`))
      .limit(40),
    db
      .select({ userId: llmCalls.userId, calls: count(), cents: sql<number>`coalesce(sum(${llmCalls.costCents}), 0)::float8` })
      .from(llmCalls)
      .where(gte(llmCalls.createdAt, sql`now() - interval '30 days'`))
      .groupBy(llmCalls.userId)
      .orderBy(desc(sql`3`))
      .limit(20),
    db
      .select({ id: llmCalls.id, purpose: llmCalls.purpose, provider: llmCalls.provider, model: llmCalls.model, error: llmCalls.error, createdAt: llmCalls.createdAt })
      .from(llmCalls)
      .where(and(eq(llmCalls.ok, false), gte(llmCalls.createdAt, sql`now() - interval '7 days'`)))
      .orderBy(desc(llmCalls.createdAt))
      .limit(15),
  ]);
  const emails = await emailsForUsers(perUser.map((r) => r.userId));
  const provider = features().llmProvider;
  const providerNote = provider === "anthropic" ? t("providerAnthropic") : provider === "local" ? t("providerLocal") : t("providerMock");

  return (
    <div className="space-y-5">
      <AdminTitle title={t("title")} lede={t("lede")} />

      <Section title={t("provider")}>
        <KeyValue
          rows={[
            { label: t("provider"), value: <Tag tone={provider === "anthropic" ? "ok" : provider === "local" ? "pine" : "warn"}>{provider}</Tag> },
            { label: "LLM_PROVIDER", value: <Mono>{env("LLM_PROVIDER") ?? "unset"}</Mono> },
            { label: t("budget"), value: fmtCents(llmUserMonthlyCents(), locale) },
          ]}
        />
        <p className="mt-3 text-[0.88rem] leading-relaxed text-ink-3">{providerNote}</p>
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={t("perDay")}>
          {perDay.length ? (
            <div className="-mx-1 overflow-x-auto px-1">
            <table className="w-full min-w-[300px] text-left text-[0.88rem]">
              <thead>
                <tr className="text-[0.76rem] uppercase tracking-[0.08em] text-ink-4">
                  <th className="py-2 font-semibold">{t("day")}</th>
                  <th className="py-2 text-right font-semibold">{t("calls")}</th>
                  <th className="py-2 text-right font-semibold">{t("failed")}</th>
                  <th className="py-2 text-right font-semibold">{t("cost")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {perDay.map((d) => (
                  <tr key={d.day}>
                    <td className="py-2">{fmtDay(`${d.day}T00:00:00Z`, locale)}</td>
                    <td className="num py-2 text-right" title={Number(d.local) ? `${fmtInt(Number(d.local), locale)} local` : undefined}>
                      {fmtInt(Number(d.calls), locale)}
                    </td>
                    <td className={`num py-2 text-right ${Number(d.failed) ? "text-bad" : ""}`}>{fmtInt(Number(d.failed), locale)}</td>
                    <td className="num py-2 text-right">{fmtCents(Number(d.cents), locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          ) : (
            <p className="text-[0.92rem] text-ink-3">{t("empty")}</p>
          )}
        </Section>

        <Section title={t("perUser")}>
          {perUser.length ? (
            <ul className="divide-y divide-[var(--line)] text-[0.88rem]">
              {perUser.map((u) => (
                <li key={u.userId ?? "system"} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0 truncate">{u.userId ? <UserLink id={u.userId} email={emails.get(u.userId)} /> : <span className="text-ink-4">{t("system")}</span>}</span>
                  <span className="num shrink-0">
                    {fmtCents(Number(u.cents), locale)} <span className="text-ink-4">· {fmtInt(Number(u.calls), locale)}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[0.92rem] text-ink-3">{t("empty")}</p>
          )}
        </Section>
      </div>

      <Section title={t("byPurpose")}>
        {byPurpose.length ? (
          <ul className="divide-y divide-[var(--line)] text-[0.88rem]">
            {byPurpose.map((p) => (
              <li key={`${p.purpose}:${p.provider}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="flex min-w-0 items-center gap-2">
                  <Mono>{p.purpose}</Mono>
                  <Tag>{p.provider}</Tag>
                </span>
                <span className="num text-ink-2">
                  {fmtInt(Number(p.calls), locale)} · {fmtCents(Number(p.cents), locale)} · {fmtInt(Number(p.ms), locale)} ms
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[0.92rem] text-ink-3">{t("empty")}</p>
        )}
      </Section>

      <Section title={t("recentFailures")}>
        {failures.length ? (
          <ul className="divide-y divide-[var(--line)] text-[0.88rem]">
            {failures.map((f) => (
              <li key={f.id} className="py-2">
                <p className="flex flex-wrap items-center gap-2">
                  <Mono>{f.purpose}</Mono>
                  <Tag>{f.provider}</Tag>
                  <span className="text-ink-4">{f.model}</span>
                  <span className="text-ink-4">{ago(f.createdAt, locale)}</span>
                </p>
                {f.error ? <p className="mt-1 break-words text-bad">{f.error.slice(0, 300)}</p> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[0.92rem] text-ink-3">{t("noFailures")}</p>
        )}
      </Section>
    </div>
  );
}
