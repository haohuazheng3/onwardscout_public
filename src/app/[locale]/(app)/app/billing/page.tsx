import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { hasLocale } from "next-intl";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import type { ReactNode } from "react";
import { CheckoutButton, CheckoutNotice } from "@/components/billing/CheckoutButton";
import { PortalButton } from "@/components/billing/PortalButton";
import { ButtonLink, Callout, PageHeader, Pane, StatPane, Tag, type TagTone } from "@/components/ui";
import { Link } from "@/i18n/navigation";
import { localizePath } from "@/i18n/paths";
import { routing, type Locale } from "@/i18n/routing";
import { currentPlan, latestSubscription, listOrders, planStatus } from "@/lib/account";
import { EXPIRING_SOON_DAYS, getBalance, listEvents, listLots, lotStatus, parseRoundKey, type LotStatus } from "@/lib/credits";
import { db } from "@/lib/db";
import { applications, opportunities } from "@/lib/db/schema";
import { shortRef } from "@/lib/ids";
import { requireUser } from "@/lib/user";
import { CREDIT_RULES, formatPrice, isSku, offerName, PASSES, passForScope, PLANS, SINGLE } from "@/content/plans";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: hasLocale(routing.locales, locale) ? locale : "en", namespace: "billing.page" });
  return { title: t("metaTitle") };
}

const LOT_TONE: Record<LotStatus, TagTone> = { active: "ok", revoked: "bad", expired: "default", usedUp: "default" };
const ORDER_TONE: Record<string, TagTone> = { paid: "ok", refunded: "warn", disputed: "bad" };

function Section({ id, title, body, children, action }: { id: string; title: string; body?: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <Pane as="section" pad="md" aria-labelledby={id} className="min-w-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 id={id} className="title text-[1.25rem] text-ink">
            {title}
          </h2>
          {body ? <p className="mt-1 text-[0.9rem] leading-relaxed text-ink-3">{body}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className="mt-4">{children}</div>
    </Pane>
  );
}

/** Opportunity names for the applications in the activity list (user-scoped, list columns only). */
async function applicationNames(userId: string, ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const rows = await db
    .select({ id: applications.id, name: opportunities.name, org: opportunities.orgName })
    .from(applications)
    .leftJoin(opportunities, eq(opportunities.id, applications.opportunityId))
    .where(and(eq(applications.userId, userId), inArray(applications.id, ids)));
  return new Map(rows.filter((r) => r.name).map((r) => [r.id, r.org ? `${r.name} · ${r.org}` : (r.name as string)]));
}

export default async function BillingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  if (!hasLocale(routing.locales, raw)) notFound();
  const locale: Locale = raw;
  setRequestLocale(locale);
  const { userId, email } = await requireUser({ locale, returnTo: localizePath("/app/billing", locale) });

  const [t, format, balance, plan, latest, lots, orders, events] = await Promise.all([
    getTranslations({ locale, namespace: "billing.page" }),
    getFormatter({ locale }),
    getBalance(userId),
    currentPlan(userId),
    latestSubscription(userId),
    listLots(userId),
    listOrders(userId),
    listEvents(userId, 20),
  ]);
  const appIds = [...new Set(events.map((e) => (e.applicationId ? parseRoundKey(e.applicationId).applicationId : null)).filter((v): v is string => Boolean(v)))];
  const names = await applicationNames(userId, appIds);

  const pro = PLANS.pro;
  const status = planStatus(plan.subscription ?? latest);
  const sub = plan.subscription ?? latest;
  const now = new Date();
  const trialLot = lots.find((l) => l.kind === "trial" && lotStatus(l, now) === "active");
  const money = (cents: number, currency: string) => format.number(cents / 100, { style: "currency", currency: currency.toUpperCase() });
  // Season passes pay only for their own programmes: shown apart from the credits any application can use.
  const passes = balance.passes.map((p) => ({ ...p, sku: passForScope(p.scope) })).filter((p) => p.sku !== null);
  const lead = passes[0];
  const passName = (sku: (typeof passes)[number]["sku"]) => (sku ? offerName(sku, locale) : "");
  const passTypes = (scope: string[]) => PASSES[passForScope(scope) ?? "season_returnship"].scopeLabel?.[locale] ?? "";

  return (
    <div className="min-w-0 space-y-4">
      <PageHeader
        eyebrow={t("eyebrow")}
        title={t("title")}
        description={t("description", { email })}
      />

      <CheckoutNotice />
      {balance.trialOnly && trialLot?.expiresAt ? (
        <Callout tone="accent">{t("trialNote", { date: trialLot.expiresAt })}</Callout>
      ) : balance.available === 0 && balance.reserved === 0 ? (
        <Callout tone="info">{t("emptyNote")}</Callout>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4 [&>*]:min-w-0">
        <StatPane
          label={t("stats.available")}
          value={balance.general}
          tone={balance.available > 0 ? "pine" : "accent"}
          hint={
            lead
              ? t("stats.availablePlusPass", { count: lead.remaining, name: passName(lead.sku) })
              : balance.reserved > 0
                ? t("stats.availableHintHeld", { count: balance.reserved })
                : t("stats.availableHintIdle")
          }
        />
        <StatPane
          label={t("stats.expiring")}
          value={balance.expiringSoon?.amount ?? 0}
          hint={
            balance.expiringSoon
              ? t("stats.expiringHint", { count: balance.expiringSoon.amount, date: balance.expiringSoon.at })
              : t("stats.expiringNone", { days: EXPIRING_SOON_DAYS })
          }
        />
        <StatPane
          label={t("stats.plan")}
          value={plan.sku ? offerName(plan.sku, locale) : lead ? passName(lead.sku) : t("stats.planNone")}
          tone={plan.sku || lead ? "accent" : "default"}
          hint={
            plan.sku
              ? t("stats.planHintPro", { price: formatPrice(pro.priceUsd), credits: pro.credits })
              : lead
                ? lead.expiresAt
                  ? t("stats.planHintPass", { count: lead.remaining, types: passTypes(lead.scope), date: lead.expiresAt })
                  : t("stats.planHintPassOpen", { count: lead.remaining, types: passTypes(lead.scope) })
                : t("stats.planHintNone", { price: formatPrice(SINGLE.priceUsd) })
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] [&>*]:min-w-0">
        <div className="min-w-0 space-y-4">
          {/* Legacy Pro (no longer sold): shown only while a subscription exists */}
          {plan.subscription ? (
            <Section
              id="plan-heading"
              title={t("plan.titleActive")}
              body={
                status === "active" && sub?.currentPeriodEnd
                  ? t("plan.renews", { date: sub.currentPeriodEnd, days: pro.rolloverDays })
                  : status === "cancelScheduled" && sub?.currentPeriodEnd
                    ? t("plan.cancelScheduled", { date: sub.currentPeriodEnd })
                    : status === "pastDue"
                      ? t("plan.pastDue")
                      : pro.blurb[locale]
              }
            >
              <div className="pane-inset flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-[0.9rem] leading-relaxed text-ink-3">{t("plan.portalNote")}</p>
                <PortalButton size="md" className="shrink-0" />
              </div>
            </Section>
          ) : null}

          {/* How paying works now: one application at a time, from its own page */}
          <Section id="unlock-heading" title={t("unlock.title", { price: formatPrice(SINGLE.priceUsd) })} body={t("unlock.body", { price: formatPrice(SINGLE.priceUsd) })}>
            <div className="flex flex-col gap-3 sm:flex-row">
              <ButtonLink href="/app/applications" prefetch={false} variant="primary" size="md">
                {t("unlock.ctaApplications")}
              </ButtonLink>
              <ButtonLink href="/app/scout" prefetch={false} variant="ghost" size="md">
                {t("unlock.ctaScout")}
              </ButtonLink>
            </div>
          </Section>

          {/* Season passes */}
          <Section id="passes-heading" title={t("passes.title")} body={t("passes.body")}>
            <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
              {Object.values(PASSES).map((p) => (
                <div key={p.sku} className="pane-inset flex flex-col gap-3 px-5 py-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-[1.05rem] font-semibold text-ink">{p.name[locale]}</p>
                    <p className="num text-[1.05rem] font-semibold text-ink">{formatPrice(p.priceUsd)}</p>
                  </div>
                  <p className="text-[0.88rem] text-ink-3">{p.blurb[locale]}</p>
                  <CheckoutButton sku={p.sku} from="billing" variant="ghost" size="md" block />
                </div>
              ))}
            </div>
          </Section>

          {/* Lots */}
          <Section id="lots-heading" title={t("lots.title")} body={t("lots.body")}>
            {lots.length === 0 ? (
              <p className="text-[0.95rem] text-ink-3">{t("lots.empty")}</p>
            ) : (
              <ul className="divide-y divide-[var(--line)]">
                {lots.map((l) => {
                  const state = lotStatus(l, now);
                  const expired = state === "expired";
                  return (
                    <li key={l.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 py-3">
                      <div className="min-w-0">
                        <p className="text-[0.95rem] font-semibold text-ink">{l.scope?.length ? t("lots.pass", { types: passTypes(l.scope) }) : t(`lots.kind.${l.kind}`)}</p>
                        <p className="text-[0.84rem] text-ink-4">
                          {t("lots.added", { date: l.createdAt })}
                          {" · "}
                          {l.expiresAt ? (expired ? t("lots.expired", { date: l.expiresAt }) : t("lots.expires", { date: l.expiresAt })) : t("lots.noExpiry")}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="num text-[0.92rem] text-ink-2">{t("lots.remaining", { remaining: l.remaining, total: l.total })}</span>
                        <Tag tone={LOT_TONE[state]}>{t(`lots.state.${state}`)}</Tag>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>

          {/* Activity */}
          <Section id="activity-heading" title={t("activity.title")}>
            {events.length === 0 ? (
              <p className="text-[0.95rem] text-ink-3">{t("activity.empty")}</p>
            ) : (
              <ul className="divide-y divide-[var(--line)]">
                {events.map((e) => {
                  const appId = e.applicationId ? parseRoundKey(e.applicationId).applicationId : null;
                  const name = appId ? (names.get(appId) ?? t("activity.anApplication")) : null;
                  const sign = e.kind === "grant" || e.kind === "release" ? "+" : e.kind === "revoke" || e.kind === "reserve" ? "−" : "";
                  return (
                    <li key={e.id} className="flex items-center justify-between gap-4 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-[0.94rem] text-ink">
                          <span className="font-semibold">{t(`activity.kind.${e.kind}`)}</span>
                          {appId && name ? (
                            <>
                              {" "}
                              <Link href={`/app/applications/${appId}`} prefetch={false} className="link">
                                {t("activity.forApplication", { name })}
                              </Link>
                            </>
                          ) : null}
                        </p>
                        <p className="text-[0.82rem] text-ink-4">{format.dateTime(e.createdAt, { dateStyle: "medium", timeStyle: "short" })}</p>
                      </div>
                      <span className="num shrink-0 text-[0.95rem] font-semibold text-ink">
                        {sign}
                        {e.amount}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>
        </div>

        <div className="min-w-0 space-y-4">
          {/* Orders */}
          <Section id="orders-heading" title={t("orders.title")}>
            {orders.length === 0 ? (
              <p className="text-[0.95rem] text-ink-3">{t("orders.empty")}</p>
            ) : (
              <ul className="divide-y divide-[var(--line)]">
                {orders.map((o) => (
                  <li key={o.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 py-3">
                    <div className="min-w-0">
                      <p className="text-[0.95rem] font-semibold text-ink">
                        {isSku(o.sku)
                          ? o.kind === "subscription"
                            ? t("orders.monthly", { name: offerName(o.sku, locale) })
                            : offerName(o.sku, locale)
                          : o.sku}
                      </p>
                      <p className="text-[0.82rem] text-ink-4">
                        {format.dateTime(o.createdAt, { dateStyle: "medium" })} · {t("orders.ref", { ref: shortRef(o.id) })}
                        {o.promoCode ? ` · ${o.promoCode.startsWith("promo_") ? t("orders.promo") : t("orders.code", { code: o.promoCode })}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="num text-[0.95rem] font-semibold text-ink">{money(o.amountTotal, o.currency)}</span>
                      <Tag tone={ORDER_TONE[o.status] ?? "default"}>{t(`orders.status.${o.status}`)}</Tag>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-4 text-[0.84rem] leading-relaxed text-ink-4">
              {t.rich("orders.footer", {
                link: (chunks) => (
                  <Link href="/refund-policy" prefetch={false} className="link">
                    {chunks}
                  </Link>
                ),
              })}
            </p>
          </Section>

          {/* Rules */}
          <Pane as="section" inset pad="md" aria-labelledby="rules-heading">
            <h2 id="rules-heading" className="eyebrow">
              {t("rules.title")}
            </h2>
            <ul className="mt-3 space-y-2 text-[0.9rem] leading-relaxed text-ink-3">
              {CREDIT_RULES.lines[locale].map((line) => (
                <li key={line} className="flex gap-2.5">
                  <span aria-hidden="true" className="mt-[0.55em] h-1 w-1 shrink-0 rounded-full bg-ink-4" />
                  <span className="min-w-0">{line}</span>
                </li>
              ))}
            </ul>
          </Pane>
        </div>
      </div>
    </div>
  );
}
