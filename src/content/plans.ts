/**
 * Single source of truth for prices, credits and plan limits. Pure and client-safe:
 * the pricing page, the app, the credit math and the Stripe bootstrap script all read
 * from here (scripts/ops/stripe-offers.mjs mirrors it; tests/plans-sync.test.ts keeps them equal).
 *
 * 1 credit = one application submitted (any channel, including a confirmed handoff)
 *            or one outreach email to a new contact.
 * Always free: profile, discovery, matching, previews, document drafts, follow-ups,
 *              practice applications.
 */

export type Locale = "en" | "zh";
export type Localized = Record<Locale, string>;

export type PlanSku = "pro";
export type PackSku = "pack10" | "pack40";
export type Sku = PlanSku | PackSku;

export interface Offer {
  sku: Sku;
  name: Localized;
  /** Whole US dollars. */
  priceUsd: number;
  credits: number;
  /** Monthly subscription, or null for a one-time pack. */
  interval: "month" | null;
  /** One-line summary under the name. */
  blurb: Localized;
  /** Benefit lines shown on the pricing page, in display order. */
  features: { en: string[]; zh: string[] };
  /**
   * Plans: days the credits of a billing period stay usable after that period ends.
   * Packs: days the credits stay usable after purchase.
   */
  rolloverDays: number;
  /** Environment variable holding the Stripe price id. */
  priceEnv: string;
  /** Plan perks the app checks (packs inherit the perks of the plan the user is on). */
  perks: { autoFollowUps: boolean; weeklyDigest: boolean; priority: boolean };
}

export const PLANS: Record<PlanSku, Offer> = {
  pro: {
    sku: "pro",
    name: { en: "Pro", zh: "Pro 会员" },
    priceUsd: 29,
    credits: 60,
    interval: "month",
    blurb: {
      en: "For people actively going after jobs, funding, programs or publications.",
      zh: "适合正在积极争取工作、融资、项目或发表机会的人。",
    },
    features: {
      en: [
        "60 credits every month: about two submitted applications a day",
        "Every channel: forms, outreach from your own Gmail, guided handoffs",
        "Automatic follow-ups when nobody answers",
        "Weekly brief: new picks, progress, decisions waiting for you",
        "Tailored documents for every application, unlimited drafts",
        "Unused credits stay usable for 30 days after each month",
      ],
      zh: [
        "每月 60 个额度：约每天替你提交两份申请",
        "全部通道：表单代填、用你自己的 Gmail 外联、引导式本人提交",
        "对方没回复时自动跟进",
        "每周简报：新机会、进展、等你拍板的事",
        "每份申请都有量身定制的材料，草稿不限次数",
        "当月未用完的额度，月末后还能再用 30 天",
      ],
    },
    rolloverDays: 30,
    priceEnv: "STRIPE_PRICE_PRO",
    perks: { autoFollowUps: true, weeklyDigest: true, priority: true },
  },
};

export const PACKS: Record<PackSku, Offer> = {
  pack10: {
    sku: "pack10",
    name: { en: "10 credits", zh: "10 个额度" },
    priceUsd: 9,
    credits: 10,
    interval: null,
    blurb: { en: "A one-time top-up, no subscription.", zh: "一次性充值，无需订阅。" },
    features: {
      en: ["10 credits, valid for 180 days", "Pay once, no renewal", "Works with every channel"],
      zh: ["10 个额度，180 天内有效", "一次付款，不自动续费", "全部通道可用"],
    },
    rolloverDays: 180,
    priceEnv: "STRIPE_PRICE_PACK_10",
    perks: { autoFollowUps: false, weeklyDigest: false, priority: false },
  },
  pack40: {
    sku: "pack40",
    name: { en: "40 credits", zh: "40 个额度" },
    priceUsd: 29,
    credits: 40,
    interval: null,
    blurb: { en: "The best price per application without a subscription.", zh: "不订阅时单份申请最划算的选择。" },
    features: {
      en: ["40 credits, valid for 180 days", "Pay once, no renewal", "Works with every channel"],
      zh: ["40 个额度，180 天内有效", "一次付款，不自动续费", "全部通道可用"],
    },
    rolloverDays: 180,
    priceEnv: "STRIPE_PRICE_PACK_40",
    perks: { autoFollowUps: false, weeklyDigest: false, priority: false },
  },
};

export const OFFERS: Record<Sku, Offer> = { ...PLANS, ...PACKS };
export const SKUS: readonly Sku[] = ["pro", "pack10", "pack40"];
export const PLAN_SKUS: readonly PlanSku[] = ["pro"];
export const PACK_SKUS: readonly PackSku[] = ["pack10", "pack40"];

export function isSku(v: unknown): v is Sku {
  return typeof v === "string" && (SKUS as readonly string[]).includes(v);
}
export function isPlanSku(v: unknown): v is PlanSku {
  return typeof v === "string" && (PLAN_SKUS as readonly string[]).includes(v);
}

/** Free credits granted on first sign-in. */
export const TRIAL = { credits: 3, expiryDays: 60 } as const;

/** What one credit buys, by action. Practice applications and follow-ups are free. */
export const CREDIT_COST = {
  submitApplication: 1,
  outreachNewContact: 1,
  followUp: 0,
  practice: 0,
} as const;

/** "$29" for whole dollars, "$3.50" otherwise. */
export function formatPrice(usd: number): string {
  const whole = Number.isInteger(usd);
  return `$${usd.toLocaleString("en-US", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })}`;
}

/** Price per credit, for the pricing comparison line. */
export function perCreditUsd(offer: Offer): number {
  return Math.round((offer.priceUsd / offer.credits) * 100) / 100;
}

export const CREDIT_RULES: { lines: Record<Locale, readonly string[]> } = {
  lines: {
    en: [
      "1 credit = one application submitted for you, or one outreach email to a new contact.",
      "Building your profile, finding and ranking opportunities, previews, document drafts and follow-ups are always free.",
      "Practice applications are free.",
      "A credit is reserved when you confirm a submission and only spent when it is submitted. If it fails or you withdraw, the credit comes back.",
      `New accounts get ${TRIAL.credits} free credits, valid for ${TRIAL.expiryDays} days.`,
      "Pro credits stay usable for 30 days after each billing month. Pack credits last 180 days.",
    ],
    zh: [
      "1 个额度 = 替你提交一份申请，或给一位新联系人发一封外联邮件。",
      "建档、找机会、排序、预览、材料草稿和跟进邮件永远免费。",
      "练习申请免费。",
      "确认提交时预留额度，真正提交后才扣除；提交失败或你撤回时，额度自动退回。",
      `新账号赠送 ${TRIAL.credits} 个免费额度，${TRIAL.expiryDays} 天内有效。`,
      "Pro 额度在每个计费月结束后还能再用 30 天；额度包 180 天内有效。",
    ],
  },
};
