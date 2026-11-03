/**
 * The Free preview / One application / Season pass comparison on /pricing, derived from
 * src/content/plans.ts so a price, a credit amount or a perk can never disagree with the catalog.
 * Pure: takes a translator, returns rows.
 */
import { PASSES, SINGLE, formatPrice, type Offer } from "@/content/plans";

export type CompareCell = { kind: "yes" } | { kind: "no" } | { kind: "text"; text: string };

export interface CompareRow {
  id: string;
  label: string;
  free: CompareCell;
  single: CompareCell;
  pass: CompareCell;
}

type T = (key: string, values?: Record<string, string | number>) => string;

const yes: CompareCell = { kind: "yes" };
const no: CompareCell = { kind: "no" };
const text = (t: string): CompareCell => ({ kind: "text", text: t });

/** `t` resolves keys under `site.pricing.compare`. */
export function compareRows(t: T): CompareRow[] {
  const returnship = PASSES.season_returnship;
  const startup = PASSES.season_startup;
  return [
    {
      id: "price",
      label: t("rowPrice"),
      free: text(t("priceFree")),
      single: text(t("priceSingle", { price: formatPrice(SINGLE.priceUsd) })),
      pass: text(t("pricePass", { price: formatPrice(returnship.priceUsd), days: returnship.rolloverDays })),
    },
    {
      id: "applications",
      label: t("rowApplications"),
      free: text(t("applicationsFree")),
      single: text(t("applicationsSingle")),
      pass: text(t("applicationsPass", { returnships: returnship.credits, startup: startup.credits })),
    },
    { id: "core", label: t("rowCore"), free: yes, single: yes, pass: yes },
    { id: "preview", label: t("rowPreview"), free: yes, single: yes, pass: yes },
    { id: "written", label: t("rowWritten"), free: no, single: yes, pass: yes },
    { id: "files", label: t("rowFiles"), free: no, single: yes, pass: yes },
    { id: "answers", label: t("rowAnswers"), free: no, single: yes, pass: yes },
    { id: "submit", label: t("rowSubmit"), free: no, single: yes, pass: yes },
    { id: "revisions", label: t("rowRevisions"), free: no, single: text(t("revisionsUnlimited")), pass: text(t("revisionsUnlimited")) },
    { id: "deadlines", label: t("rowDeadlines"), free: yes, single: yes, pass: yes },
    { id: "practice", label: t("rowPractice"), free: yes, single: yes, pass: yes },
    { id: "account", label: t("rowAccount"), free: text(t("accountNone")), single: text(t("accountNone")), pass: text(t("accountNeeded")) },
  ];
}

/** "$0.82" — the price of one application on a pass, for its card. */
export function perApplicationLabel(offer: Offer): string {
  return formatPrice(Math.round((offer.priceUsd / Math.max(1, offer.credits)) * 100) / 100);
}
