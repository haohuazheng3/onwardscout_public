/**
 * The Free / Packs / Pro comparison on /pricing, derived from src/content/plans.ts so a price,
 * credit amount or perk can never disagree with the catalog. Pure: takes a translator, returns rows.
 */
import { PACKS, PLANS, TRIAL, formatPrice, perCreditUsd, type Offer } from "@/content/plans";

export type CompareCell = { kind: "yes" } | { kind: "no" } | { kind: "text"; text: string };

export interface CompareRow {
  id: string;
  label: string;
  free: CompareCell;
  packs: CompareCell;
  pro: CompareCell;
}

type T = (key: string, values?: Record<string, string | number>) => string;

const yes: CompareCell = { kind: "yes" };
const no: CompareCell = { kind: "no" };
const text = (t: string): CompareCell => ({ kind: "text", text: t });
const perk = (on: boolean): CompareCell => (on ? yes : no);

/**
 * `t` resolves keys under `site.pricing.compare`. `mailer`: product email is configured (the
 * weekly brief by email is a Pro perk; until email is on it says so instead of promising it).
 */
export function compareRows(t: T, opts: { mailer?: boolean } = {}): CompareRow[] {
  const pro = PLANS.pro;
  const pack = PACKS.pack10;
  return [
    {
      id: "credits",
      label: t("rowCredits"),
      free: text(t("creditsFree", { credits: TRIAL.credits, days: TRIAL.expiryDays })),
      packs: text(t("creditsPacks", { small: PACKS.pack10.credits, large: PACKS.pack40.credits, days: pack.rolloverDays })),
      pro: text(t("creditsPro", { credits: pro.credits, days: pro.rolloverDays })),
    },
    { id: "core", label: t("rowCore"), free: yes, packs: yes, pro: yes },
    { id: "practice", label: t("rowPractice"), free: yes, packs: yes, pro: yes },
    { id: "channels", label: t("rowChannels"), free: yes, packs: yes, pro: yes },
    {
      id: "followups",
      label: t("rowFollowUps"),
      free: text(t("followUpsTap")),
      packs: text(pack.perks.autoFollowUps ? t("followUpsAuto") : t("followUpsTap")),
      pro: text(pro.perks.autoFollowUps ? t("followUpsAuto") : t("followUpsTap")),
    },
    // The weekly brief itself is in the app for everyone; only its email copy is a Pro perk.
    { id: "digest", label: t("rowDigest"), free: yes, packs: yes, pro: yes },
    {
      id: "digestEmail",
      label: t("rowDigestEmail"),
      free: no,
      packs: perk(pack.perks.weeklyDigest),
      pro: pro.perks.weeklyDigest ? (opts.mailer ? yes : text(t("comingSoon"))) : no,
    },
    {
      id: "renewal",
      label: t("rowRenewal"),
      free: text(t("renewalNone")),
      packs: text(t("renewalPacks")),
      pro: text(t("renewalPro")),
    },
  ];
}

/** "$0.73" — the price of one credit in an offer, for the pack and plan cards. */
export function perCreditLabel(offer: Offer): string {
  return formatPrice(perCreditUsd(offer));
}
