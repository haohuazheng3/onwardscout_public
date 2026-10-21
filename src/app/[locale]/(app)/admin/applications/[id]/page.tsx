import { asc, desc, eq, sql } from "drizzle-orm";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { SubmitButton } from "@/components/admin/AdminClient";
import { AdminTitle, Json, KeyValue, Mono, Section, StatusTag, UserLink, ago, fmtDate } from "@/components/admin/AdminUi";
import { Tag } from "@/components/ui";
import { Link } from "@/i18n/navigation";
import { db } from "@/lib/db";
import { applicationSteps, applications, events, jobs, messages, opportunities } from "@/lib/db/schema";
import { cancelJobAction, retryJobAction } from "../../actions";
import { adminLocale, emailsForUsers, requireAdminOnce } from "../../_lib/data";
import { AdminNotice } from "../../_lib/notice";

export const dynamic = "force-dynamic";

type Params = Promise<{ locale: string; id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function AdminApplicationPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const locale = await adminLocale(params);
  await requireAdminOnce();
  const { id } = await params;
  if (!/^app_[0-9a-z]{8,32}$/.test(id)) notFound();
  const sp = await searchParams;

  const found = await db
    .select({ app: applications, oppName: opportunities.name, oppSlug: opportunities.slug, oppUrl: opportunities.url, oppType: opportunities.type })
    .from(applications)
    .leftJoin(opportunities, eq(opportunities.id, applications.opportunityId))
    .where(eq(applications.id, id))
    .limit(1);
  const row = found[0];
  if (!row) notFound();
  const app = row.app;

  const [t, tc, steps, jobRows, eventRows, messageRows, emails] = await Promise.all([
    getTranslations({ locale, namespace: "admin.application" }),
    getTranslations({ locale, namespace: "admin.common" }),
    db.select().from(applicationSteps).where(eq(applicationSteps.applicationId, id)).orderBy(asc(applicationSteps.n)),
    db
      .select()
      .from(jobs)
      .where(sql`${jobs.payload}->>'applicationId' = ${id}`)
      .orderBy(desc(jobs.createdAt))
      .limit(30),
    db.select().from(events).where(eq(events.applicationId, id)).orderBy(desc(events.createdAt)).limit(40),
    db
      .select({ id: messages.id, direction: messages.direction, channel: messages.channel, subject: messages.subject, status: messages.status, classification: messages.classification, createdAt: messages.createdAt })
      .from(messages)
      .where(eq(messages.applicationId, id))
      .orderBy(desc(messages.createdAt))
      .limit(20),
    emailsForUsers([app.userId]),
  ]);
  const path = `/admin/applications/${id}`;

  return (
    <div className="space-y-5">
      <AdminTitle
        title={row.oppName ?? app.id}
        lede={
          <span className="flex flex-wrap items-center gap-2">
            <Mono>{app.id}</Mono>
            <StatusTag status={app.status} />
            <Mono>{app.channel}</Mono>
            {app.practice ? <Tag>{tc("practice")}</Tag> : null}
          </span>
        }
      />
      <AdminNotice sp={sp} locale={locale} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={tc("details")}>
          <KeyValue
            rows={[
              { label: tc("user"), value: <UserLink id={app.userId} email={emails.get(app.userId)} /> },
              {
                label: t("openOpportunity"),
                value: (
                  <span className="flex flex-wrap justify-end gap-2">
                    <Link href={`/admin/opportunities/${app.opportunityId}`} prefetch={false} className="text-accent-text">
                      {app.opportunityId}
                    </Link>
                    {row.oppUrl ? (
                      <a href={row.oppUrl} target="_blank" rel="noopener noreferrer" className="break-all text-ink-3 underline">
                        {row.oppType}
                      </a>
                    ) : null}
                  </span>
                ),
              },
              { label: tc("created"), value: fmtDate(app.createdAt, locale) },
              { label: tc("updated"), value: fmtDate(app.updatedAt, locale) },
              { label: t("credits"), value: String(app.creditsReserved) },
              { label: t("followUp"), value: app.followUpAt ? `${fmtDate(app.followUpAt, locale)} (${app.followUpsSent})` : "—" },
              ...(app.needsYouReason ? [{ label: "needs_you_reason", value: app.needsYouReason }] : []),
              ...(app.externalRef ? [{ label: "external_ref", value: <Mono>{app.externalRef}</Mono> }] : []),
            ]}
          />
        </Section>

        <Section title={t("jobs")}>
          {jobRows.length ? (
            <ul className="divide-y divide-[var(--line)]">
              {jobRows.map((j) => (
                <li key={j.id} className="py-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex min-w-0 flex-wrap items-center gap-2">
                      <Mono title={j.id}>{j.kind}</Mono>
                      <StatusTag status={j.status} />
                      <span className="text-[0.8rem] text-ink-4">{t("attempts", { attempts: j.attempts, max: j.maxAttempts })}</span>
                    </span>
                    <span className="flex gap-2">
                      {j.status === "failed" || j.status === "cancelled" ? (
                        <form action={retryJobAction}>
                          <input type="hidden" name="locale" value={locale} />
                          <input type="hidden" name="path" value={path} />
                          <input type="hidden" name="id" value={j.id} />
                          <SubmitButton variant="primary" pendingLabel={t("retrying")}>
                            {t("retry")}
                          </SubmitButton>
                        </form>
                      ) : null}
                      {j.status === "queued" || j.status === "running" ? (
                        <form action={cancelJobAction}>
                          <input type="hidden" name="locale" value={locale} />
                          <input type="hidden" name="path" value={path} />
                          <input type="hidden" name="id" value={j.id} />
                          <SubmitButton variant="quiet" pendingLabel={t("cancelling")}>
                            {t("cancel")}
                          </SubmitButton>
                        </form>
                      ) : null}
                    </span>
                  </div>
                  {j.error ? <p className="mt-1 break-words text-[0.82rem] text-bad">{j.error}</p> : null}
                  <p className="mt-0.5 text-[0.78rem] text-ink-4">{ago(j.updatedAt, locale)}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[0.92rem] text-ink-3">{t("noJobs")}</p>
          )}
        </Section>
      </div>

      <Section title={t("steps")}>
        {steps.length ? (
          <ol className="divide-y divide-[var(--line)]">
            {steps.map((s) => (
              <li key={s.id} className="py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <span className="num w-6 text-ink-4">{s.n}</span>
                    <Mono>{s.kind}</Mono>
                    <StatusTag status={s.status} />
                  </span>
                  <span className="text-[0.8rem] text-ink-4">
                    {s.startedAt ? fmtDate(s.startedAt, locale) : "—"}
                    {s.finishedAt ? ` → ${fmtDate(s.finishedAt, locale)}` : ""}
                  </span>
                </div>
                {s.error ? <p className="mt-1 break-words text-[0.85rem] text-bad">{s.error}</p> : null}
                {s.input || s.output ? (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[0.82rem] text-ink-3">{tc("raw")}</summary>
                    <div className="mt-2 grid gap-2 md:grid-cols-2">
                      {s.input ? <Json value={s.input} max="max-h-60" /> : null}
                      {s.output ? <Json value={s.output} max="max-h-60" /> : null}
                    </div>
                  </details>
                ) : null}
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-[0.92rem] text-ink-3">{t("noSteps")}</p>
        )}
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={t("events")}>
          {eventRows.length ? (
            <ul className="divide-y divide-[var(--line)] text-[0.88rem]">
              {eventRows.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-3 py-2">
                  <Mono>{e.kind}</Mono>
                  <span className="text-ink-4" title={fmtDate(e.createdAt, locale)}>
                    {ago(e.createdAt, locale)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[0.92rem] text-ink-3">—</p>
          )}
        </Section>
        <Section title={t("messages")}>
          {messageRows.length ? (
            <ul className="divide-y divide-[var(--line)] text-[0.88rem]">
              {messageRows.map((m) => (
                <li key={m.id} className="py-2">
                  <p className="flex flex-wrap items-center gap-2">
                    <Tag>{m.direction}</Tag>
                    <Tag>{m.channel}</Tag>
                    <StatusTag status={m.status} />
                    {m.classification ? <Tag tone="pine">{m.classification}</Tag> : null}
                    <span className="text-ink-4">{ago(m.createdAt, locale)}</span>
                  </p>
                  {m.subject ? <p className="mt-1 break-words text-ink">{m.subject}</p> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[0.92rem] text-ink-3">—</p>
          )}
        </Section>
      </div>

      <Section title={tc("raw")}>
        <div className="grid gap-3 md:grid-cols-3">
          <div className="min-w-0">
            <p className="eyebrow mb-1.5">{t("questions")}</p>
            <Json value={app.questions} max="max-h-64" />
          </div>
          <div className="min-w-0">
            <p className="eyebrow mb-1.5">{t("answers")}</p>
            <Json value={app.answers} max="max-h-64" />
          </div>
          <div className="min-w-0">
            <p className="eyebrow mb-1.5">{t("evidence")}</p>
            <Json value={{ evidence: app.evidence, outcome: app.outcome }} max="max-h-64" />
          </div>
        </div>
      </Section>
    </div>
  );
}
