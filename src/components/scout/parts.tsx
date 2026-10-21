"use client";

import { CalendarClock, FileText, Hand, Mail, MapPin, MousePointerClick, Wallet } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { materialLabel } from "@/lib/core/materials";
import type { MaterialId } from "@/lib/core/types";
import { benefitsFacts, countryLabel, deadlineInfo, whatYoullDo } from "@/lib/opportunities/present";
import type { OpportunityCard } from "@/lib/opportunities/types";
import { Tag, cx } from "@/components/ui";
import { materialIcon } from "./icons";

/* Small pieces shared by the board cards and the detail page. */

/** Up to `max` material icons with accessible names, then "+N". */
export function MaterialIcons({ materials, max = 4, className }: { materials: MaterialId[]; max?: number; className?: string }) {
  const t = useTranslations("scout.card");
  const locale = useLocale();
  if (!materials.length) return null;
  const shown = materials.slice(0, max);
  const labels = materials.map((m) => materialLabel(m, locale));
  return (
    <div className={cx("flex min-w-0 items-center gap-1.5", className)} aria-label={t("materials", { list: labels.join(", ") })} role="img">
      {shown.map((m) => {
        const Icon = materialIcon(m);
        return (
          <span key={m} title={materialLabel(m, locale)} className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-pane-2 text-ink-3" aria-hidden="true">
            <Icon size={14} />
          </span>
        );
      })}
      {materials.length > max ? (
        <span className="num text-[0.8rem] text-ink-4" aria-hidden="true">
          +{materials.length - max}
        </span>
      ) : null}
    </div>
  );
}

/** "87% fit" in pine; hidden for the practice run (it is not a fit, it is a rehearsal). */
export function FitBadge({ fit, className }: { fit: number | null | undefined; className?: string }) {
  const t = useTranslations("scout.card");
  if (fit === null || fit === undefined || fit <= 0) return null;
  return (
    <Tag tone="pine" dot className={cx("num shrink-0", className)}>
      {t("fit", { fit: Math.round(fit) })}
    </Tag>
  );
}

/** Deadline countdown; warns under seven days. */
export function DeadlineText({ deadline, rolling, now, className, long = false }: { deadline: string | null; rolling: boolean; now: Date; className?: string; long?: boolean }) {
  const t = useTranslations("scout.deadline");
  const format = useFormatter();
  const info = deadlineInfo(deadline, rolling, now);
  let text: string;
  let urgent = false;
  switch (info.kind) {
    case "closed":
      text = t("closed");
      break;
    case "today":
      text = t("today");
      urgent = true;
      break;
    case "days":
      text = t("days", { days: info.days });
      urgent = info.urgent;
      break;
    case "date":
      text = t("on", { date: format.dateTime(new Date(info.date), { day: "numeric", month: "short", year: "numeric" }) });
      break;
    case "rolling":
      text = t("rolling");
      break;
    default:
      text = t("unknown");
  }
  const dated = long && deadline && (info.kind === "days" || info.kind === "today");
  return (
    <span className={cx("inline-flex min-w-0 items-center gap-1.5", urgent ? "font-semibold text-warn" : "text-ink-3", className)}>
      <CalendarClock size={15} className="shrink-0" aria-hidden />
      <span className="min-w-0 truncate">
        {text}
        {dated ? <span className="font-normal text-ink-4"> · {format.dateTime(new Date(deadline), { day: "numeric", month: "short", year: "numeric" })}</span> : null}
      </span>
    </span>
  );
}

/** "What you'll do", by channel. */
export function WhatYoullDo({ card, className }: { card: Pick<OpportunityCard, "channel" | "requiresAccount" | "captchaLikely">; className?: string }) {
  const t = useTranslations("scout.do");
  const key = whatYoullDo(card);
  const Icon = key === "handoff" || key === "confirmHandoff" ? Hand : key === "email" ? Mail : key === "documents" ? FileText : MousePointerClick;
  return (
    <span className={cx("inline-flex min-w-0 items-center gap-1.5 text-ink-3", className)}>
      <Icon size={15} className="shrink-0" aria-hidden />
      <span className="min-w-0 truncate">{t(key)}</span>
    </span>
  );
}

/** "Remote", "Anywhere", "Berlin, Germany", "Hybrid · London". */
export function useLocationText() {
  const t = useTranslations("scout.location");
  const locale = useLocale();
  return (geo: OpportunityCard["geo"]): string | null => {
    if (geo.worldwide) return t("anywhere");
    const place = [geo.cities[0], geo.countries[0] ? countryLabel(geo.countries[0], locale) : null].filter(Boolean).join(", ");
    if (geo.remote === "remote") return place ? t("remoteFrom", { place }) : t("remote");
    if (geo.remote === "hybrid") return place ? t("hybridIn", { place }) : t("hybrid");
    return place || null;
  };
}

export function LocationText({ geo, className }: { geo: OpportunityCard["geo"]; className?: string }) {
  const text = useLocationText()(geo);
  if (!text) return null;
  return (
    <span className={cx("inline-flex min-w-0 items-center gap-1.5", className)}>
      <MapPin size={14} className="shrink-0" aria-hidden />
      <span className="min-w-0 truncate">{text}</span>
    </span>
  );
}

/** The benefits line: money (by kind), else the organiser's summary or perks; plus free / fee / equity. */
export function useBenefitsText() {
  const t = useTranslations("scout.benefits");
  const locale = useLocale();
  return (card: Pick<OpportunityCard, "benefits" | "cost">): string | null => {
    const f = benefitsFacts(card.benefits, card.cost, locale);
    const parts: string[] = [];
    if (f.money) {
      const amount = f.period && f.period !== "once" && f.period !== "project" ? `${f.money}${t(`per.${f.period}`)}` : f.money;
      parts.push(t(`money.${f.moneyKind ?? "other"}`, { amount }));
    } else if (f.summary) parts.push(f.summary);
    else if (f.perks.length) parts.push(f.perks.join(" · "));
    if (f.visaSponsorship) parts.push(t("visa"));
    if (f.fee) parts.push(t("fee", { amount: f.fee }));
    else if (f.free) parts.push(t("free"));
    if (f.equityPercent) parts.push(t("equity", { percent: f.equityPercent }));
    return parts.length ? parts.join(" · ") : null;
  };
}

export function BenefitsText({ card, className }: { card: Pick<OpportunityCard, "benefits" | "cost">; className?: string }) {
  const text = useBenefitsText()(card);
  if (!text) return null;
  return (
    <span className={cx("inline-flex min-w-0 items-start gap-1.5", className)}>
      <Wallet size={15} className="mt-[3px] shrink-0" aria-hidden />
      <span className="min-w-0 line-clamp-2">{text}</span>
    </span>
  );
}
