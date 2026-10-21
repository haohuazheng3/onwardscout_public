/**
 * Presentation helpers shared by the board cards, the detail page and API consumers: what the
 * person will have to do (by channel), the deadline countdown and money ranges. Pure and
 * client-safe; the words themselves live in messages/<locale>/scout.json.
 */
import type { ChannelId, OpportunityBenefits, OpportunityCost } from "@/lib/core/types";

/** "What you'll do" by channel (message key under scout.do.*). */
export type DoKey = "confirm" | "confirmHandoff" | "email" | "handoff" | "documents";

export function whatYoullDo(card: { channel: ChannelId; requiresAccount?: boolean; captchaLikely?: boolean }): DoKey {
  switch (card.channel) {
    case "CH4":
      return "email";
    case "CH5":
      return "documents";
    case "CH6":
      return "handoff";
    default:
      return card.requiresAccount || card.captchaLikely ? "confirmHandoff" : "confirm";
  }
}

export type DeadlineInfo =
  | { kind: "closed" }
  | { kind: "today"; urgent: true }
  | { kind: "days"; days: number; urgent: boolean }
  | { kind: "date"; date: string; urgent: false }
  | { kind: "rolling" }
  | { kind: "unknown" };

/** Days at which a countdown turns into a warning. */
export const URGENT_DAYS = 7;

/**
 * The deadline as a person reads it: "closes today", "closes in 5 days" (urgent under 7),
 * a date when it is more than 60 days away, "rolling", or "not listed".
 */
export function deadlineInfo(deadline: string | Date | null, rolling: boolean, now: Date = new Date()): DeadlineInfo {
  if (!deadline) return rolling ? { kind: "rolling" } : { kind: "unknown" };
  const d = deadline instanceof Date ? deadline : new Date(deadline);
  if (Number.isNaN(d.getTime())) return rolling ? { kind: "rolling" } : { kind: "unknown" };
  const ms = d.getTime() - now.getTime();
  if (ms < 0) return { kind: "closed" };
  const days = Math.ceil(ms / 86_400_000);
  if (ms < 86_400_000 && d.getUTCDate() === now.getUTCDate()) return { kind: "today", urgent: true };
  if (days > 60) return { kind: "date", date: d.toISOString(), urgent: false };
  return { kind: "days", days, urgent: days < URGENT_DAYS };
}

/** "$5K", "$5K–$10K", "€1.2M", "¥80K" — compact, in the person's locale; null without an amount. */
export function formatMoneyRange(money: { min?: number | null; max?: number | null; currency?: string | null } | null | undefined, locale: string): string | null {
  if (!money) return null;
  const min = typeof money.min === "number" && money.min > 0 ? money.min : null;
  const max = typeof money.max === "number" && money.max > 0 ? money.max : null;
  if (min === null && max === null) return null;
  const currency = money.currency && /^[A-Z]{3}$/.test(money.currency) ? money.currency : null;
  const fmt = (n: number) => {
    try {
      return new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "en-US", {
        notation: "compact",
        maximumFractionDigits: n >= 1_000_000 ? 1 : 0,
        ...(currency ? { style: "currency", currency, currencyDisplay: "narrowSymbol" } : {}),
      }).format(n);
    } catch {
      return String(n);
    }
  };
  if (min !== null && max !== null && min !== max) return `${fmt(min)}–${fmt(max)}`;
  return fmt((max ?? min) as number);
}

/** What the benefits line can say, without inventing anything (unknown parts are absent). */
export interface BenefitsFacts {
  money: string | null;
  moneyKind: NonNullable<OpportunityBenefits["money"]>["kind"] | null;
  period: NonNullable<OpportunityBenefits["money"]>["period"] | null;
  summary: string | null;
  perks: string[];
  free: boolean | null;
  fee: string | null;
  equityPercent: number | null;
  visaSponsorship: boolean | null;
}

export function benefitsFacts(benefits: OpportunityBenefits | null, cost: OpportunityCost | null, locale: string): BenefitsFacts {
  const money = benefits?.money ?? null;
  const fee = cost?.applicationFee?.amount ? formatMoneyRange({ min: cost.applicationFee.amount, currency: cost.applicationFee.currency }, locale) : null;
  return {
    money: formatMoneyRange(money, locale),
    moneyKind: money?.kind ?? null,
    period: money?.period ?? null,
    summary: benefits?.summary?.trim() || null,
    perks: (benefits?.perks ?? []).map((p) => p.trim()).filter(Boolean).slice(0, 4),
    free: cost?.free ?? null,
    fee,
    equityPercent: typeof cost?.equityPercent === "number" ? cost.equityPercent : null,
    visaSponsorship: benefits?.visaSponsorship ?? null,
  };
}

/** Host of an official URL for "on example.org" labels (null when unparsable). */
export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Country name in the person's language (falls back to the code). */
export function countryLabel(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale === "zh" ? "zh-CN" : "en"], { type: "region" }).of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}
