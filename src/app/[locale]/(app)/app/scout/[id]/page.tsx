import { ArrowLeft, Check, CircleCheck, CircleHelp, CircleX, ExternalLink, Info, Timer } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { DetailActions, StickyApply } from "@/components/scout/DetailActions";
import { ApplyButton } from "@/components/scout/ApplyButton";
import { materialIcon } from "@/components/scout/icons";
import { BenefitsText, DeadlineText, FitBadge, LocationText, WhatYoullDo } from "@/components/scout/parts";
import { ButtonLink, Callout, Pane, Tag, cx } from "@/components/ui";
import { Link } from "@/i18n/navigation";
import { localizePath } from "@/i18n/paths";
import { routing } from "@/i18n/routing";
import { channelLabel, getChannel, localize } from "@/lib/core";
import { getMaterial } from "@/lib/core/materials";
import { opportunityTypeLabel } from "@/lib/core/opportunity-types";
import { features } from "@/lib/env";
import { readProfile } from "@/lib/llm/types";
import { eligibilityChecklist, type CheckStatus } from "@/lib/opportunities/eligibility";
import { hostOf } from "@/lib/opportunities/present";
import { getDetailForUser, similarOpportunities } from "@/lib/opportunities/queries";
import { getProfile } from "@/lib/profile";
import { optionalUser, requireUser } from "@/lib/user";

type Params = Promise<{ locale: string; id: string }>;

const ID = /^opp_[0-9a-z]{4,40}$/;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale, id } = await params;
  const t = await getTranslations({ locale: hasLocale(routing.locales, locale) ? locale : "en", namespace: "scout" });
  // The name only when this person may see it (shares the page's cached lookup).
  const session = ID.test(id) ? await optionalUser() : null;
  const detail = session ? await getDetailForUser(session.userId, id) : null;
  return { title: detail ? detail.opportunity.name : t("meta.detailTitle") };
}

const STATUS_ICON: Record<CheckStatus, { Icon: typeof CircleCheck; className: string }> = {
  yes: { Icon: CircleCheck, className: "text-ok" },
  no: { Icon: CircleX, className: "text-bad" },
  unknown: { Icon: CircleHelp, className: "text-warn" },
};

function Section({ title, children, className, id }: { title: string; children: React.ReactNode; className?: string; id?: string }) {
  return (
    <Pane as="section" pad="md" className={cx("min-w-0", className)} aria-labelledby={id}>
      <h2 id={id} className="title text-[1.2rem] text-ink">
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </Pane>
  );
}

export default async function OpportunityPage({ params }: { params: Params }) {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const { userId } = await requireUser({ locale, returnTo: localizePath(`/app/scout/${id}`, locale) });
  if (!ID.test(id)) notFound();

  const detail = await getDetailForUser(userId, id);
  if (!detail) notFound();
  const { opportunity: o, match, application } = detail;
  const [t, profileRow, similar] = await Promise.all([
    getTranslations({ locale, namespace: "scout" }),
    getProfile(userId),
    similarOpportunities(userId, o.id, o.type, 4),
  ]);

  const now = new Date();
  const nowIso = now.toISOString();
  const practice = o.type === "practice";
  const checklist = eligibilityChecklist({ eligibility: o.eligibility, geo: o.geo, languages: o.languages }, readProfile(profileRow ?? {}), locale, now);
  const channel = getChannel(o.channel);
  const scoringAi = features().llmProvider === "anthropic";
  const officialUrl = o.url ?? o.applyUrl;
  const paragraphs = (o.description ?? "").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);

  const notes: string[] = [];
  if (o.mine) notes.push(t("detail.how.mine"));
  if (o.channel === "CH4") notes.push(t("detail.how.email"));
  else if (o.channel === "CH5") notes.push(t("detail.how.documents"));
  else if (o.requiresAccount) notes.push(t("detail.how.login"));
  if (o.captchaLikely && o.channel !== "CH6") notes.push(t("detail.how.captcha"));
  if (o.requiresPayment || o.cost?.applicationFee?.amount) notes.push(t("detail.how.fee"));
  if (practice) notes.push(t("detail.how.practice"));
  notes.push(t("detail.how.tap"));

  return (
    <article className="min-w-0 pb-24 lg:pb-0">
      <Link href="/app/scout" className="press -ml-1 inline-flex items-center gap-1.5 rounded-full px-1 py-1 text-[0.92rem] font-medium text-ink-3 hover:text-ink">
        <ArrowLeft size={16} aria-hidden />
        {t("detail.back")}
      </Link>

      <header className="mt-4 min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <Tag>{opportunityTypeLabel(o.type, locale)}</Tag>
          {practice ? <Tag tone="ok">{t("card.practiceFree")}</Tag> : <FitBadge fit={match?.fit} />}
          {o.mine ? <Tag>{t("card.addedByYou")}</Tag> : null}
          {o.status === "unverified" ? <Tag tone="warn">{t("detail.unverified")}</Tag> : o.verifiedAt ? <Tag tone="ok" dot>{t("detail.verified")}</Tag> : null}
          {application ? <Tag tone="ink">{t("card.applied")}</Tag> : null}
        </div>
        <h1 className="headline mt-3 text-[1.8rem] leading-tight text-ink sm:text-[2.3rem]">{o.name}</h1>
        <p className="mt-2 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-[0.98rem] text-ink-3">
          {o.orgName ? <span className="font-medium text-ink-2">{o.orgName}</span> : null}
          <LocationText geo={o.geo} />
          {o.cycle ? <span>{o.cycle}</span> : null}
        </p>
        {o.summary ? <p className="dek mt-3 max-w-3xl text-[1.04rem] leading-relaxed text-ink-2">{o.summary}</p> : null}
      </header>

      <div className="mt-6 grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start [&>*]:min-w-0">
        {/* side: deadline, value, time, apply — first on phones */}
        <aside className="order-first grid gap-4 lg:order-none lg:col-start-2 lg:row-start-1 lg:sticky lg:top-24">
          <Pane pad="md" className="min-w-0">
            <div className="grid gap-2.5 text-[0.94rem]">
              <DeadlineText deadline={o.deadline} rolling={o.rolling} now={now} long />
              <BenefitsText card={o} className="text-ink-3" />
              <WhatYoullDo card={o} />
              {match?.effortMinutes ? (
                <span className="inline-flex items-center gap-1.5 text-ink-3">
                  <Timer size={15} className="shrink-0" aria-hidden />
                  {t("detail.minutes", { minutes: match.effortMinutes })}
                </span>
              ) : null}
            </div>
            <div className="mt-5 hidden lg:block">
              <ApplyButton opportunityId={o.id} type={o.type} channel={o.channel} goalId={match?.goalId} applicationId={application?.id} practice={practice} block size="lg" />
            </div>
            <div className="mt-3">
              <DetailActions opportunityId={o.id} matchId={match?.id ?? null} feedback={match?.feedback ?? null} practice={practice} />
            </div>
            <div className="mt-4 border-t border-line pt-4">
              {officialUrl ? (
                <ButtonLink href={officialUrl} external variant="ghost" size="sm" block iconRight={<ExternalLink size={15} aria-hidden />}>
                  {t("detail.official", { host: hostOf(officialUrl) ?? officialUrl })}
                </ButtonLink>
              ) : (
                <p className="text-[0.88rem] text-ink-3">{t("detail.noOfficial")}</p>
              )}
              <p className="mt-3 text-[0.82rem] leading-relaxed text-ink-4">{t("detail.unknownNote")}</p>
            </div>
          </Pane>
        </aside>

        <div className="grid min-w-0 gap-4 lg:col-start-1 lg:row-start-1">
          {practice ? (
            <Section title={t("detail.practice.title")} id="why">
              <ul className="grid gap-2">
                {(match?.reasons.length ? match.reasons : [t("detail.practice.one"), t("detail.practice.two"), t("detail.practice.three")]).map((r) => (
                  <li key={r} className="flex gap-2.5 text-[0.98rem] leading-relaxed text-ink-2">
                    <Check size={17} className="mt-[3px] shrink-0 text-pine" aria-hidden />
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </Section>
          ) : match && (match.reasons.length || match.gaps.length) ? (
            <Section title={t("detail.why.title")} id="why">
              {match.reasons.length ? (
                <ul className="grid gap-2">
                  {match.reasons.map((r) => (
                    <li key={r} className="flex gap-2.5 text-[0.98rem] leading-relaxed text-ink-2">
                      <Check size={17} className="mt-[3px] shrink-0 text-pine" aria-hidden />
                      <span>{r}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {match.gaps.length ? (
                <div className={match.reasons.length ? "mt-5" : undefined}>
                  <h3 className="text-[0.95rem] font-semibold text-ink">{t("detail.why.gaps")}</h3>
                  <ul className="mt-2 grid gap-2">
                    {match.gaps.map((g) => (
                      <li key={g} className="flex gap-2.5 text-[0.95rem] leading-relaxed text-ink-2">
                        <Info size={16} className="mt-[3px] shrink-0 text-warn" aria-hidden />
                        <span>{g}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <p className="mt-4 text-[0.84rem] text-ink-4">{scoringAi ? t("detail.why.ai") : t("detail.why.local")}</p>
            </Section>
          ) : null}

          {!practice ? (
            <Section title={t("detail.eligibility.title")} id="eligibility">
              {checklist.length ? (
                <ul className="grid gap-3">
                  {checklist.map((c, i) => {
                    const { Icon, className } = STATUS_ICON[c.status];
                    return (
                      <li key={`${c.key}-${i}`} className="flex gap-3 text-[0.96rem] leading-relaxed text-ink-2">
                        <Icon size={19} className={cx("mt-[2px] shrink-0", className)} aria-hidden />
                        <span>
                          <span className="sr-only">{t(`eligibility.status.${c.status}`)}: </span>
                          {t(`eligibility.${c.key}.${c.status}`, c.values)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-[0.96rem] leading-relaxed text-ink-3">{t("eligibility.none")}</p>
              )}
            </Section>
          ) : null}

          <Section title={t("detail.about.title")} id="about">
            {paragraphs.length ? (
              <div className="grid gap-3 text-[0.98rem] leading-relaxed text-ink-2">
                {paragraphs.map((p, i) => (
                  <p key={i} className="whitespace-pre-line break-words">
                    {p}
                  </p>
                ))}
              </div>
            ) : (
              <p className="text-[0.96rem] leading-relaxed text-ink-3">{t("detail.about.none")}</p>
            )}
            {o.tags.length ? (
              <div className="mt-5 flex flex-wrap gap-1.5">
                {o.tags.map((tag) => (
                  <Tag key={tag}>{tag}</Tag>
                ))}
              </div>
            ) : null}
          </Section>

          <Section title={t("detail.required.title")} id="required">
            {o.requiredMaterials.length ? (
              <ul className="grid gap-3">
                {o.requiredMaterials.map((mId) => {
                  const def = getMaterial(mId);
                  const Icon = materialIcon(mId);
                  return (
                    <li key={mId} className="flex items-start gap-3">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-pane-2 text-ink-3" aria-hidden="true">
                        <Icon size={16} />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[0.98rem] font-medium text-ink">{localize(def.label, locale)}</span>
                        <span className="block text-[0.88rem] text-ink-3">{t(`detail.required.by.${def.producedBy}`)}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-[0.96rem] leading-relaxed text-ink-3">{t("detail.required.none")}</p>
            )}
          </Section>

          <Section title={t("detail.how.title")} id="how">
            <div className="flex flex-wrap items-center gap-2">
              <Tag tone="pine">{channelLabel(o.channel, locale)}</Tag>
              <WhatYoullDo card={o} className="text-[0.95rem] font-medium text-ink-2" />
            </div>
            <p className="mt-3 text-[0.96rem] leading-relaxed text-ink-2">{localize(channel.description, locale)}</p>
            <p className="mt-2 text-[0.96rem] leading-relaxed text-ink-2">{localize(channel.userAction, locale)}</p>
            <ul className="mt-4 grid gap-2">
              {notes.map((n) => (
                <li key={n} className="flex gap-2.5 text-[0.94rem] leading-relaxed text-ink-3">
                  <Info size={16} className="mt-[3px] shrink-0 text-pine" aria-hidden />
                  <span>{n}</span>
                </li>
              ))}
            </ul>
            {o.channel === "CH4" ? (
              <div className="mt-4">
                <ButtonLink href="/app/integrations" variant="ghost" size="sm">
                  {t("detail.how.connectGmail")}
                </ButtonLink>
              </div>
            ) : null}
            {o.instructions ? (
              <Callout tone="info" title={t("detail.how.instructions")} className="mt-4">
                <span className="whitespace-pre-line">{o.instructions}</span>
              </Callout>
            ) : null}
          </Section>

          {similar.length ? (
            <Section title={t("detail.similar.title")} id="similar">
              <ul className="grid gap-2.5">
                {similar.map(({ opportunity: s, match: sm }) => (
                  <li key={s.id}>
                    <Link href={`/app/scout/${s.id}`} className="pane-inset press flex min-w-0 items-center justify-between gap-3 px-4 py-3.5 hover:bg-pane-3">
                      <span className="min-w-0">
                        <span className="block truncate text-[0.98rem] font-medium text-ink">{s.name}</span>
                        <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-3 text-[0.86rem] text-ink-3">
                          {s.orgName ? <span className="truncate">{s.orgName}</span> : null}
                          <DeadlineText deadline={s.deadline} rolling={s.rolling} now={now} />
                        </span>
                      </span>
                      <FitBadge fit={sm?.fit} />
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
        </div>
      </div>

      <StickyApply
        opportunityId={o.id}
        type={o.type}
        channel={o.channel}
        goalId={match?.goalId ?? null}
        applicationId={application?.id ?? null}
        deadline={o.deadline}
        rolling={o.rolling}
        nowIso={nowIso}
      />
    </article>
  );
}
