"use client";

import { Award, BookOpen, Briefcase, FolderGit2, GraduationCap, IdCard, Layers, Medal, Package, Wrench } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useState, type ReactNode } from "react";
import { EmptyState, cx } from "@/components/ui";
import { toast } from "@/components/ui-client";
import { useRouter } from "@/i18n/navigation";
import { localize } from "@/lib/core/labels";
import { isOccupationCode, occupationLabel } from "@/lib/core/occupations";
import type { Profile } from "@/lib/core/types";
import { countryName } from "@/lib/llm/local/geo";
import { setAt, valueAt } from "@/lib/profile/merge";
import { RESEARCH_FIELDS } from "@/lib/profile/gaps";
import { api } from "@/components/onboarding/api";
import { FactDialog, SourceChip } from "./FactDialog";
import { dateRange, factForPath, factForValue, formatPartialDate, type FactView } from "./facts";

/*
 * "Your record, with sources": every value on the profile with a chip saying where it came
 * from — a document (tap: the quote and the file), the person's own word, or nothing (said
 * plainly). Confirm or fix any of them in place.
 */

export interface DocName {
  id: string;
  filename: string | null;
}

function Section({ id, icon, title, count, children }: { id: string; icon: ReactNode; title: string; count?: number; children: ReactNode }) {
  return (
    <section className="pane min-w-0 p-5 sm:p-7" aria-labelledby={`sec-${id}`}>
      <div className="flex items-center gap-2.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-pane-2 text-ink-2 shadow-[inset_0_0_0_1px_var(--line)]">{icon}</span>
        <h2 id={`sec-${id}`} className="title min-w-0 flex-1 truncate text-[1.18rem] text-ink">
          {title}
        </h2>
        {typeof count === "number" ? <span className="num text-[0.86rem] text-ink-4">{count}</span> : null}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Row({ title, meta, body, chip }: { title: ReactNode; meta?: ReactNode; body?: ReactNode; chip: ReactNode }) {
  return (
    <li className="flex min-w-0 items-start gap-3 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1">
        <p className="text-[0.98rem] font-medium leading-snug text-ink">{title}</p>
        {meta ? <p className="mt-0.5 text-[0.86rem] text-ink-3">{meta}</p> : null}
        {body ? <div className="mt-1.5 text-[0.88rem] leading-relaxed text-ink-3">{body}</div> : null}
      </div>
      {chip}
    </li>
  );
}

export function ProfileRecord({ profile: initialProfile, facts: initialFacts, docs, locale }: { profile: Profile; facts: FactView[]; docs: DocName[]; locale: "en" | "zh" }) {
  const t = useTranslations("profile.record");
  const tc = useTranslations("common");
  const router = useRouter();
  const [profile, setProfile] = useState(initialProfile);
  const [facts, setFacts] = useState(initialFacts);
  const [open, setOpen] = useState<{ fact: FactView; path: string } | null>(null);
  const [seen, setSeen] = useState({ p: initialProfile, f: initialFacts });
  if (seen.p !== initialProfile || seen.f !== initialFacts) {
    setSeen({ p: initialProfile, f: initialFacts });
    setProfile(initialProfile);
    setFacts(initialFacts);
  }

  const docName = useCallback((id: string | null) => (id ? (docs.find((d) => d.id === id)?.filename ?? null) : null), [docs]);
  const msgs = { network: tc("errors.network"), generic: tc("errors.generic") };

  const chipFor = (fact: FactView | null, path: string) => (
    <SourceChip
      fact={fact}
      docName={docName}
      onOpen={() => {
        if (fact) setOpen({ fact, path });
        else toast.info(t("noSourceToast"));
      }}
    />
  );

  async function confirm(fact: FactView) {
    const before = facts;
    setFacts((cur) => cur.map((f) => (f.id === fact.id ? { ...f, confirmedByUser: true } : f)));
    try {
      await api(`/api/profile/facts/${fact.id}`, { method: "PATCH", json: { action: "confirm", locale } }, msgs);
      toast.success(t("confirmedToast"), { duration: 1800 });
      router.refresh();
    } catch (err) {
      setFacts(before);
      toast.error(tc("errors.rolledBack"), { body: err instanceof Error ? err.message : undefined });
      throw err;
    }
  }

  async function fix(fact: FactView, value: Record<string, unknown> | string) {
    const beforeFacts = facts;
    const beforeProfile = profile;
    const path = fact.path;
    try {
      const current = valueAt(profile, path);
      const next = typeof value === "string" ? value : { ...((current ?? {}) as Record<string, unknown>), ...Object.fromEntries(Object.entries(value).map(([k, v]) => [k, v === "" ? null : k === "year" && v ? Number(v) : v])) };
      setProfile((p) => {
        try {
          return setAt(p, path, next);
        } catch {
          return p;
        }
      });
      setFacts((cur) => cur.map((f) => (f.id === fact.id ? { ...f, value: next, confirmedByUser: true } : f)));
      const res = await api<{ fact: { claim: string; value: unknown } }>(`/api/profile/facts/${fact.id}`, { method: "PATCH", json: { action: "fix", value, locale } }, msgs);
      setFacts((cur) => cur.map((f) => (f.id === fact.id ? { ...f, claim: res.fact.claim, value: res.fact.value } : f)));
      toast.success(t("fixedToast"), { duration: 1800 });
      router.refresh();
    } catch (err) {
      setFacts(beforeFacts);
      setProfile(beforeProfile);
      toast.error(tc("errors.rolledBack"), { body: err instanceof Error ? err.message : undefined });
      throw err;
    }
  }

  const present = t("present");
  const id = profile.identity;
  const identityRows: { key: string; label: string; value: string | null }[] = [
    { key: "name", label: t("name"), value: id.name },
    { key: "headline", label: t("headline"), value: id.headline },
    { key: "email", label: t("email"), value: id.email },
    { key: "phone", label: t("phone"), value: id.phone },
    { key: "location", label: t("location"), value: id.location },
  ];

  const packs = profile.packs;
  const venture = packs.founder?.ventures[0];
  const packRows: { label: string; value: string; path: string }[] = [];
  if (packs.jobSeeker) {
    const j = packs.jobSeeker;
    if (j.targetOccupations.length) packRows.push({ label: t("pack.targetRoles"), value: j.targetOccupations.map((c) => (isOccupationCode(c) ? occupationLabel(c, locale) : c)).join(", "), path: "/packs/jobSeeker/targetOccupations" });
    if (j.remote) packRows.push({ label: t("pack.remote"), value: t(`pack.remoteOptions.${j.remote}`), path: "/packs/jobSeeker/remote" });
    if (j.salaryMin != null || j.salaryMax != null) {
      const fmt = (n: number) => new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "en-US", { style: j.currency ? "currency" : "decimal", currency: j.currency ?? undefined, maximumFractionDigits: 0 }).format(n);
      packRows.push({ label: t("pack.salary"), value: j.salaryMin != null && j.salaryMax != null ? `${fmt(j.salaryMin)} – ${fmt(j.salaryMax)}` : j.salaryMin != null ? `${fmt(j.salaryMin)}+` : `≤ ${fmt(j.salaryMax!)}`, path: "/packs/jobSeeker/salary" });
    }
    if (j.availableFrom) packRows.push({ label: t("pack.start"), value: formatPartialDate(j.availableFrom, locale), path: "/packs/jobSeeker/availableFrom" });
  }
  if (venture) {
    const base = `/packs/founder/ventures/${venture.id}`;
    packRows.push({ label: t("pack.company"), value: [venture.company, venture.oneLiner].filter(Boolean).join(" — "), path: base });
    if (venture.stage) packRows.push({ label: t("pack.stage"), value: t(`pack.stages.${venture.stage}`), path: `${base}/stage` });
    if (venture.teamSize) packRows.push({ label: t("pack.team"), value: t("pack.teamValue", { count: venture.teamSize }), path: `${base}/teamSize` });
    const traction = [venture.traction.revenue?.text, venture.traction.users?.text, venture.traction.growth?.text].filter(Boolean).join(" · ");
    if (traction) packRows.push({ label: t("pack.traction"), value: traction, path: `${base}/traction` });
    if (venture.currentRound?.amount) packRows.push({ label: t("pack.round"), value: new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "en-US", { style: venture.currentRound.currency ? "currency" : "decimal", currency: venture.currentRound.currency ?? undefined, maximumFractionDigits: 0 }).format(venture.currentRound.amount), path: `${base}/currentRound` });
  }
  if (packs.researcher) {
    const r = packs.researcher;
    if (r.fields.length) packRows.push({ label: t("pack.fields"), value: r.fields.map((f) => localize(RESEARCH_FIELDS.find((x) => x.label.en === f)?.label ?? { en: f, zh: f }, locale)).join(", "), path: "/packs/researcher/fields" });
    if (r.targetTier) packRows.push({ label: t("pack.tier"), value: t(`pack.tiers.${r.targetTier}`), path: "/packs/researcher/targetTier" });
    if (r.orcid) packRows.push({ label: "ORCID", value: r.orcid, path: "/packs/researcher/orcid" });
  }
  if (packs.student) {
    const s = packs.student;
    if (s.graduationDate) packRows.push({ label: t("pack.graduation"), value: formatPartialDate(s.graduationDate, locale), path: "/packs/student/graduationDate" });
    if (s.targetDegree) packRows.push({ label: t("pack.targetDegree"), value: t(`pack.degrees.${s.targetDegree}`), path: "/packs/student/targetDegree" });
    for (const ts of s.testScores) packRows.push({ label: ts.test, value: ts.score, path: "/packs/student/testScores" });
  }
  if (packs.creator) {
    const c = packs.creator;
    if (c.rates?.min != null || c.rates?.max != null) {
      const fmt = (n: number) => new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "en-US", { style: c.rates?.currency ? "currency" : "decimal", currency: c.rates?.currency ?? undefined, maximumFractionDigits: 0 }).format(n);
      packRows.push({ label: t("pack.rates"), value: c.rates?.min != null && c.rates?.max != null ? `${fmt(c.rates.min)} – ${fmt(c.rates.max)}` : c.rates?.min != null ? `${fmt(c.rates.min)}+` : `≤ ${fmt(c.rates!.max!)}`, path: "/packs/creator/rates" });
    }
    for (const a of c.audienceMetrics) packRows.push({ label: a.platform, value: a.followers != null ? t("pack.followers", { count: a.followers }) : "—", path: "/packs/creator/audienceMetrics" });
  }
  if (packs.professional) for (const l of packs.professional.licenses) packRows.push({ label: t("pack.license"), value: [l.type, l.jurisdiction].filter(Boolean).join(" · "), path: "/packs/professional/licenses" });

  const nothing = !profile.experience.length && !profile.education.length && !profile.projects.length && !profile.skills.length && !identityRows.some((r) => r.value);

  return (
    <div className="grid gap-4">
      {nothing ? <EmptyState title={t("emptyTitle")} body={t("emptyBody")} /> : null}

      <Section id="identity" icon={<IdCard size={17} aria-hidden />} title={t("identity")}>
        <ul className="divide-y divide-[var(--line)]">
          {identityRows.map((r) => {
            const path = `/identity/${r.key}`;
            return (
              <Row
                key={r.key}
                title={r.value ? <span className="break-words">{r.value}</span> : <span className="text-ink-4">{t("notGiven")}</span>}
                meta={r.label}
                chip={r.value ? chipFor(factForPath(facts, path), path) : null}
              />
            );
          })}
          {id.links.map((l) => (
            <Row
              key={l.url}
              title={
                <a href={/^https?:/i.test(l.url) ? l.url : `https://${l.url}`} target="_blank" rel="noopener noreferrer" className="link break-all">
                  {l.url.replace(/^https?:\/\//, "")}
                </a>
              }
              meta={t("link", { kind: l.kind })}
              chip={chipFor(factForValue(facts, "/identity/links", l, "url"), "/identity/links")}
            />
          ))}
          {id.languages.length ? <Row title={id.languages.map((l) => `${l.code.toUpperCase()}${l.level ? ` · ${t(`levels.${l.level}`)}` : ""}`).join(", ")} meta={t("languages")} chip={chipFor(factForPath(facts, "/identity/languages"), "/identity/languages")} /> : null}
          {id.workAuthorization.length ? (
            <Row title={id.workAuthorization.map((w) => `${countryName(w.countryCode, locale)} · ${t(`auth.${w.status}`)}`).join(", ")} meta={t("workAuth")} chip={chipFor(factForPath(facts, "/identity/workAuthorization"), "/identity/workAuthorization")} />
          ) : null}
        </ul>
        {profile.summary ? (
          <div className="pane-inset mt-4 flex items-start gap-3 px-4 py-3">
            <p className="min-w-0 flex-1 text-[0.92rem] leading-relaxed text-ink-2">{profile.summary}</p>
            {chipFor(factForPath(facts, "/summary"), "/summary")}
          </div>
        ) : null}
      </Section>

      {profile.experience.length ? (
        <Section id="experience" icon={<Briefcase size={17} aria-hidden />} title={t("experience")} count={profile.experience.length}>
          <ul className="divide-y divide-[var(--line)]">
            {profile.experience.map((e) => {
              const path = `/experience/${e.id}`;
              return (
                <Row
                  key={e.id}
                  title={`${e.title} · ${e.organization}`}
                  meta={[dateRange(e.startDate, e.endDate, e.current, locale, present), e.location].filter(Boolean).join(" · ")}
                  body={e.highlights.length ? <ul className="list-disc space-y-0.5 pl-4">{e.highlights.slice(0, 3).map((h, i) => <li key={i}>{h}</li>)}</ul> : e.summary}
                  chip={chipFor(factForPath(facts, path), path)}
                />
              );
            })}
          </ul>
        </Section>
      ) : null}

      {profile.education.length ? (
        <Section id="education" icon={<GraduationCap size={17} aria-hidden />} title={t("education")} count={profile.education.length}>
          <ul className="divide-y divide-[var(--line)]">
            {profile.education.map((e) => {
              const path = `/education/${e.id}`;
              return <Row key={e.id} title={e.institution} meta={[[e.degree, e.field].filter(Boolean).join(", "), dateRange(e.startDate, e.endDate, e.current, locale, present)].filter(Boolean).join(" · ")} chip={chipFor(factForPath(facts, path), path)} />;
            })}
          </ul>
        </Section>
      ) : null}

      {profile.projects.length ? (
        <Section id="projects" icon={<FolderGit2 size={17} aria-hidden />} title={t("projects")} count={profile.projects.length}>
          <ul className="divide-y divide-[var(--line)]">
            {profile.projects.map((p) => {
              const path = `/projects/${p.id}`;
              return <Row key={p.id} title={p.name} meta={[p.role, p.url?.replace(/^https?:\/\//, "")].filter(Boolean).join(" · ")} body={p.summary} chip={chipFor(factForPath(facts, path), path)} />;
            })}
          </ul>
        </Section>
      ) : null}

      {profile.skills.length ? (
        <Section id="skills" icon={<Wrench size={17} aria-hidden />} title={t("skills")} count={profile.skills.length}>
          <ul className="flex flex-wrap gap-2">
            {profile.skills.map((s) => {
              const fact = factForValue(facts, "/skills", s, "name");
              return (
                <li key={s.name} className="min-w-0 max-w-full">
                  <button
                    type="button"
                    onClick={() => (fact ? setOpen({ fact, path: fact.path }) : toast.info(t("noSourceToast")))}
                    className={cx(
                      "press inline-flex min-h-[36px] max-w-full items-center gap-1.5 rounded-full px-3 text-[0.88rem]",
                      fact?.confirmedByUser ? "bg-pine-soft text-ink" : fact ? "bg-pane-2 text-ink-2 shadow-[inset_0_0_0_1px_var(--line)]" : "bg-warn-soft text-ink",
                    )}
                  >
                    <span className={cx("h-1.5 w-1.5 shrink-0 rounded-full", fact?.confirmedByUser ? "bg-pine" : fact ? "bg-ink-4" : "bg-warn")} aria-hidden="true" />
                    <span className="truncate">{s.name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-[0.82rem] text-ink-4">{t("skillsHint")}</p>
        </Section>
      ) : null}

      {profile.publications.length ? (
        <Section id="publications" icon={<BookOpen size={17} aria-hidden />} title={t("publications")} count={profile.publications.length}>
          <ul className="divide-y divide-[var(--line)]">
            {profile.publications.map((p) => {
              const path = `/publications/${p.id}`;
              return <Row key={p.id} title={p.title} meta={[p.venue, p.year].filter(Boolean).join(" · ")} chip={chipFor(factForPath(facts, path), path)} />;
            })}
          </ul>
        </Section>
      ) : null}

      {profile.achievements.length ? (
        <Section id="achievements" icon={<Medal size={17} aria-hidden />} title={t("achievements")} count={profile.achievements.length}>
          <ul className="divide-y divide-[var(--line)]">
            {profile.achievements.map((a) => {
              const path = `/achievements/${a.id}`;
              return <Row key={a.id} title={a.title} meta={[a.issuer, formatPartialDate(a.date, locale)].filter(Boolean).join(" · ")} chip={chipFor(factForPath(facts, path), path)} />;
            })}
          </ul>
        </Section>
      ) : null}

      {profile.certifications.length ? (
        <Section id="certifications" icon={<Award size={17} aria-hidden />} title={t("certifications")} count={profile.certifications.length}>
          <ul className="divide-y divide-[var(--line)]">
            {profile.certifications.map((c) => {
              const path = `/certifications/${c.id}`;
              return <Row key={c.id} title={c.name} meta={[c.issuer, formatPartialDate(c.issuedAt, locale)].filter(Boolean).join(" · ")} chip={chipFor(factForPath(facts, path), path)} />;
            })}
          </ul>
        </Section>
      ) : null}

      {packRows.length ? (
        <Section id="packs" icon={<Package size={17} aria-hidden />} title={t("packs")}>
          <ul className="divide-y divide-[var(--line)]">
            {packRows.map((r, i) => (
              <Row key={`${r.path}:${i}`} title={r.value} meta={r.label} chip={chipFor(factForPath(facts, r.path), r.path)} />
            ))}
          </ul>
        </Section>
      ) : null}

      {facts.some((f) => !f.confirmedByUser && f.sourceDocId && f.confidence < 0.5 && !f.path.startsWith("/roles/")) ? (
        <p className="flex items-start gap-2 px-1 text-[0.86rem] text-ink-3">
          <Layers size={15} className="mt-0.5 shrink-0 text-warn" aria-hidden />
          {t("unsureNote")}
        </p>
      ) : null}

      <FactDialog fact={open?.fact ?? null} initialValue={open ? valueAt(profile, open.fact.path) : undefined} docName={docName} onClose={() => setOpen(null)} onConfirm={confirm} onFix={fix} />
    </div>
  );
}
