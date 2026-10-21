import { count, desc, eq, isNull, and } from "drizzle-orm";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { SubmitButton } from "@/components/admin/AdminClient";
import { AdminTitle, KeyValue, Mono, Section, StatusTag, ago, fmtDate, fmtInt } from "@/components/admin/AdminUi";
import { Field, Input, Tag } from "@/components/ui";
import { Link } from "@/i18n/navigation";
import { identityLabel, isIdentityCode } from "@/lib/core";
import { listLots } from "@/lib/credits";
import { db } from "@/lib/db";
import { applications, authorizations, documents, events, facts, goals, notifications, opportunities, profiles, users } from "@/lib/db/schema";
import { inboundAddress } from "@/lib/site";
import { grantCreditsAction } from "../../actions";
import { adminLocale, availableCredits, requireAdminOnce } from "../../_lib/data";
import { AdminNotice } from "../../_lib/notice";

export const dynamic = "force-dynamic";

type Params = Promise<{ locale: string; id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function AdminUserPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const locale = await adminLocale(params);
  await requireAdminOnce();
  const { id: rawId } = await params;
  const id = decodeURIComponent(rawId);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) notFound();
  const sp = await searchParams;

  const found = await db.select().from(users).where(eq(users.id, id)).limit(1);
  const user = found[0];
  if (!user) notFound();

  const [t, tc, profileRows, factCount, docCount, goalRows, appRows, lots, credits, autRows, ntfRows, eventRows] = await Promise.all([
    getTranslations({ locale, namespace: "admin.user" }),
    getTranslations({ locale, namespace: "admin.common" }),
    db.select().from(profiles).where(eq(profiles.userId, id)).limit(1),
    db.select({ n: count() }).from(facts).where(eq(facts.userId, id)),
    db.select({ n: count() }).from(documents).where(eq(documents.userId, id)),
    db.select({ id: goals.id, label: goals.label, family: goals.family, status: goals.status }).from(goals).where(eq(goals.userId, id)).orderBy(desc(goals.updatedAt)),
    db
      .select({ id: applications.id, status: applications.status, practice: applications.practice, updatedAt: applications.updatedAt, name: opportunities.name })
      .from(applications)
      .leftJoin(opportunities, eq(opportunities.id, applications.opportunityId))
      .where(eq(applications.userId, id))
      .orderBy(desc(applications.updatedAt))
      .limit(30),
    listLots(id, 30),
    availableCredits([id]),
    db.select({ scope: authorizations.scope, grantedAt: authorizations.grantedAt }).from(authorizations).where(and(eq(authorizations.userId, id), isNull(authorizations.revokedAt))),
    db.select().from(notifications).where(eq(notifications.userId, id)).orderBy(desc(notifications.createdAt)).limit(10),
    db.select().from(events).where(eq(events.userId, id)).orderBy(desc(events.createdAt)).limit(15),
  ]);
  const profile = profileRows[0] ?? null;
  const path = `/admin/users/${encodeURIComponent(id)}`;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-5">
      <AdminTitle title={user.email} lede={<Mono>{user.id}</Mono>} />
      <AdminNotice sp={sp} locale={locale} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={t("account")}>
          <KeyValue
            rows={[
              { label: t("locale"), value: user.locale },
              { label: tc("created"), value: fmtDate(user.createdAt, locale) },
              { label: tc("updated"), value: ago(user.lastSeenAt, locale) },
              { label: t("inbound"), value: user.inboundToken ? <Mono>{inboundAddress(user.inboundToken)}</Mono> : tc("none") },
              { label: t("stripeCustomer"), value: user.stripeCustomerId ? <Mono>{user.stripeCustomerId}</Mono> : tc("none") },
              {
                label: t("authorizations"),
                value: autRows.length ? (
                  <span className="flex flex-wrap justify-end gap-1.5">
                    {autRows.map((a) => (
                      <Tag key={a.scope}>{a.scope}</Tag>
                    ))}
                  </span>
                ) : (
                  t("noAuthorizations")
                ),
              },
            ]}
          />
        </Section>

        <Section title={t("profile")}>
          {profile ? (
            <KeyValue
              rows={[
                { label: tc("status"), value: <StatusTag status={profile.status} /> },
                { label: t("name"), value: profile.identity?.name ?? "—" },
                {
                  label: t("roles"),
                  value: profile.roles.length
                    ? profile.roles.map((r) => (isIdentityCode(r.code) ? `${r.code} ${identityLabel(r.code, locale)}` : r.code)).join(", ")
                    : "—",
                },
                { label: t("completeness"), value: `${profile.completeness}%` },
                { label: t("facts"), value: fmtInt(Number(factCount[0]?.n ?? 0), locale) },
                { label: t("documents"), value: fmtInt(Number(docCount[0]?.n ?? 0), locale) },
              ]}
            />
          ) : (
            <p className="text-[0.92rem] text-ink-3">{t("noProfile")}</p>
          )}
        </Section>

        <Section title={t("goals")}>
          {goalRows.length ? (
            <ul className="divide-y divide-[var(--line)]">
              {goalRows.map((g) => (
                <li key={g.id} className="flex items-center justify-between gap-3 py-2 text-[0.9rem]">
                  <span className="min-w-0 truncate">
                    <span className="text-ink-4">{g.family}</span> {g.label}
                  </span>
                  <StatusTag status={g.status} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[0.92rem] text-ink-3">{t("noGoals")}</p>
          )}
        </Section>

        <Section title={t("applications")}>
          {appRows.length ? (
            <ul className="divide-y divide-[var(--line)]">
              {appRows.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 py-2 text-[0.9rem]">
                  <Link href={`/admin/applications/${a.id}`} prefetch={false} className="min-w-0 truncate text-ink underline-offset-2 hover:underline">
                    {a.name ?? a.id}
                    {a.practice ? <span className="text-ink-4"> · {tc("practice")}</span> : null}
                  </Link>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="text-[0.8rem] text-ink-4">{ago(a.updatedAt, locale)}</span>
                    <StatusTag status={a.status} />
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[0.92rem] text-ink-3">{t("noApplications")}</p>
          )}
        </Section>

        <Section title={t("credits")}>
          <p className="text-[0.92rem] text-ink-3">
            {t("available")}: <span className="num text-[1.2rem] font-semibold text-ink">{fmtInt(credits.get(id) ?? 0, locale)}</span>
          </p>
          <p className="eyebrow mt-4">{t("lots")}</p>
          {lots.length ? (
            <ul className="mt-1 divide-y divide-[var(--line)] text-[0.88rem]">
              {lots.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="flex items-center gap-2">
                    <Tag>{l.kind}</Tag>
                    <span className="num">
                      {l.remaining} / {l.total}
                    </span>
                    {l.status !== "active" ? <StatusTag status={l.status} /> : null}
                  </span>
                  <span className="text-ink-4">{l.expiresAt ? fmtDate(l.expiresAt, locale) : "∞"}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-[0.9rem] text-ink-3">{t("noLots")}</p>
          )}

          <form action={grantCreditsAction} className="pane-inset mt-5 space-y-3 p-4">
            <p className="font-semibold text-ink">{t("grantTitle")}</p>
            <p className="text-[0.86rem] leading-relaxed text-ink-3">{t("grantBody")}</p>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="path" value={path} />
            <input type="hidden" name="userId" value={id} />
            <div className="grid gap-3 sm:grid-cols-[120px_minmax(0,1fr)]">
              <Field id="grant-amount" label={t("amount")}>
                <Input id="grant-amount" name="amount" type="number" inputMode="numeric" min={1} max={500} defaultValue={5} required />
              </Field>
              <Field id="grant-key" label={t("key")} hint={t("keyHint")}>
                <Input id="grant-key" name="key" defaultValue={`support-${today}`} pattern="[A-Za-z0-9-]{3,60}" required aria-describedby="grant-key-hint" />
              </Field>
            </div>
            <SubmitButton variant="primary" pendingLabel={t("granting")}>
              {t("grant")}
            </SubmitButton>
          </form>
        </Section>

        <Section title={t("notifications")}>
          {ntfRows.length ? (
            <ul className="divide-y divide-[var(--line)] text-[0.88rem]">
              {ntfRows.map((nt) => (
                <li key={nt.id} className="py-2">
                  <p className="flex flex-wrap items-center gap-2 text-[0.78rem] text-ink-4">
                    <Tag>{nt.kind}</Tag>
                    {ago(nt.createdAt, locale)}
                    {nt.readAt ? null : <Tag tone="accent">{t("unread")}</Tag>}
                    {nt.emailedAt ? <Tag tone="ok">{t("emailed")}</Tag> : null}
                  </p>
                  <p className="mt-1 break-words text-ink">{nt.title}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[0.92rem] text-ink-3">{t("noRows")}</p>
          )}
        </Section>

        <Section title={t("events")} className="lg:col-span-2">
          {eventRows.length ? (
            <ul className="divide-y divide-[var(--line)] text-[0.88rem]">
              {eventRows.map((e) => (
                <li key={e.id} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between">
                  <span className="flex min-w-0 items-center gap-2">
                    <Mono>{e.kind}</Mono>
                    {e.applicationId ? (
                      <Link href={`/admin/applications/${e.applicationId}`} prefetch={false} className="truncate text-accent-text">
                        {e.applicationId}
                      </Link>
                    ) : null}
                  </span>
                  <span className="text-ink-4" title={fmtDate(e.createdAt, locale)}>
                    {ago(e.createdAt, locale)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[0.92rem] text-ink-3">{t("noRows")}</p>
          )}
        </Section>
      </div>
    </div>
  );
}
