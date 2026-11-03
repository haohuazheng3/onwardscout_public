/**
 * Single source of truth for prices, credits and plan limits. Pure and client-safe:
 * the pricing page, the app, the credit math and the Stripe bootstrap script all read
 * from here (scripts/ops/stripe-offers.mjs mirrors it; tests/plans-sync.test.ts keeps them equal).
 *
 * The model since 2026-11-03: the preview of an application is free (drafted by the template
 * engine from the person's own files), and **unlocking** one application is what is paid for —
 * $19 once, or one credit of a season pass. An unlocked application is written in full with
 * Claude, can be downloaded (Word / PDF), copied answer by answer and submitted or handed over.
 * 1 credit = one application unlocked. Season passes (one payment, 90 days) carry credits scoped
 * to one goal's programme types. Pro and the credit packs are no longer sold (LEGACY_SKUS); what
 * was bought keeps working.
 * Always free: profile, discovery, matching, previews, follow-ups, practice applications.
 */

export type Locale = "en" | "zh";
export type Localized = Record<Locale, string>;

/** One application unlocked, paid once (signed in or not). */
export type SingleSku = "single";
export type PlanSku = "pro";
export type PackSku = "pack10" | "pack40";
/** Season passes: one payment, one goal, one season (90 days) — credits only for that goal's programmes. */
export type PassSku = "season_returnship" | "season_startup";
export type Sku = SingleSku | PlanSku | PackSku | PassSku;

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
  /**
   * Plan perks the app checks (packs inherit the perks of the plan the user is on):
   * automatic follow-ups (the `auto_followup` switch only acts with this perk), and the weekly
   * brief by email (the in-app brief is free for everyone).
   */
  perks: { autoFollowUps: boolean; weeklyDigest: boolean; deadlineEmails?: boolean };
  /**
   * Opportunity types the credits can be spent on (season passes); absent = any application.
   * Scoped credits are used before general ones for a matching application, never for another.
   */
  scope?: readonly string[];
  /** What a season pass pays for, in plain words ("returnships"). */
  scopeLabel?: Localized;
  /** Where a season pass holder finds the programmes it pays for. */
  browsePath?: string;
}

/** One application, paid once: the unlock behind every "Unlock for $19" button. */
export const SINGLE: Offer = {
  sku: "single",
  name: { en: "One application", zh: "单份申请" },
  priceUsd: 19,
  credits: 1,
  interval: null,
  blurb: {
    en: "This application written in full with Claude from your own résumé, ready to download, copy and submit.",
    zh: "这一份申请由 Claude 依据你自己的简历完整写成，可下载、逐项复制并提交。",
  },
  features: {
    en: [
      "Every document rewritten in full with Claude, from your résumé and this posting",
      "Word and PDF downloads, and every form answer ready to copy",
      "Submission by Onward Scout where the form allows it, a step-by-step handoff where it doesn't",
      "Unlimited revisions of this application: tell the AI what to change",
      "Pay once, no account needed to pay",
    ],
    zh: [
      "每份材料都由 Claude 依据你的简历和这条招募完整重写",
      "Word 和 PDF 下载，每个表单回答一键复制",
      "表单允许时由 Onward Scout 提交，不允许时提供逐步交接",
      "这份申请不限次数修改：告诉 AI 要改什么",
      "一次付费，付款前无需注册",
    ],
  },
  rolloverDays: 0,
  priceEnv: "STRIPE_PRICE_SINGLE",
  perks: { autoFollowUps: false, weeklyDigest: false },
};

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
        "Automatic follow-ups (once you switch them on) until a reply is recorded",
        "The weekly brief by email too: new picks, progress, decisions waiting for you",
        "Tailored documents for every application, unlimited drafts",
        "Unused credits stay usable for 30 days after each month",
      ],
      zh: [
        "每月 60 个额度：约每天替你提交两份申请",
        "全部通道：表单代填、用你自己的 Gmail 外联、引导式本人提交",
        "自动跟进（由你开启），直到记录到对方回复为止",
        "每周简报同时发到邮箱：新机会、进展、等你拍板的事",
        "每份申请都有量身定制的材料，草稿不限次数",
        "当月未用完的额度，月末后还能再用 30 天",
      ],
    },
    rolloverDays: 30,
    priceEnv: "STRIPE_PRICE_PRO",
    perks: { autoFollowUps: true, weeklyDigest: true },
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
    perks: { autoFollowUps: false, weeklyDigest: false },
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
    perks: { autoFollowUps: false, weeklyDigest: false },
  },
};


/** The founder programmes a startup season pass covers. */
export const STARTUP_PASS_TYPES = ["accelerator", "incubator", "pitch_event", "startup_competition"] as const;

export const PASSES: Record<PassSku, Offer> = {
  season_returnship: {
    sku: "season_returnship",
    name: { en: "Returnship season pass", zh: "返岗申请季通行证" },
    priceUsd: 49,
    credits: 60,
    interval: null,
    blurb: {
      en: "One payment for a whole round of returnship applications, career-break résumé included.",
      zh: "一次付费，包办一整轮返岗项目申请，含空窗期简历。",
    },
    features: {
      en: [
        "90 days of returnship applications: every programme that fits you (up to 60)",
        "A returner résumé, cover letter and career-break note for each programme",
        "Deadline reminders by email for the programmes you saved or started",
        "Pay once, no renewal",
      ],
      zh: [
        "90 天内申请所有适合你的返岗项目（最多 60 个）",
        "每个项目都有返岗简历、求职信和职业空窗说明",
        "你收藏或开始申请的项目，截止前发邮件提醒",
        "一次付款，不自动续费",
      ],
    },
    rolloverDays: 90,
    priceEnv: "STRIPE_PRICE_SEASON_RETURNSHIP",
    perks: { autoFollowUps: false, weeklyDigest: false, deadlineEmails: true },
    scope: ["returnship"],
    scopeLabel: { en: "returnships", zh: "返岗项目" },
    browsePath: "/app/scout?view=all&type=returnship",
  },
  season_startup: {
    sku: "season_startup",
    name: { en: "Startup season pass", zh: "创业申请季通行证" },
    priceUsd: 49,
    credits: 10,
    interval: null,
    blurb: {
      en: "A pitch deck, a one-pager and ten accelerator or competition applications in one go.",
      zh: "路演 Deck、一页纸，加 10 个加速器或创业比赛的申请，一次搞定。",
    },
    features: {
      en: [
        "10 applications to accelerators, incubators, pitch events or startup competitions, within 90 days",
        "Your pitch deck (PowerPoint and PDF) and one-pager, revised as many times as you like",
        "Deadline reminders by email for the programmes you saved or started",
        "Pay once, no renewal",
      ],
      zh: [
        "90 天内 10 个加速器、孵化器、路演或创业比赛的申请",
        "你的路演 Deck（PowerPoint 和 PDF）和一页纸，不限次数修改",
        "你收藏或开始申请的项目，截止前发邮件提醒",
        "一次付款，不自动续费",
      ],
    },
    rolloverDays: 90,
    priceEnv: "STRIPE_PRICE_SEASON_STARTUP",
    perks: { autoFollowUps: false, weeklyDigest: false, deadlineEmails: true },
    scope: STARTUP_PASS_TYPES,
    scopeLabel: { en: "accelerators, incubators, pitch events and startup competitions", zh: "加速器、孵化器、路演和创业比赛" },
    browsePath: "/app/scout?view=all&group=funding&type=accelerator",
  },
};

export const OFFERS: Record<Sku, Offer> = { single: SINGLE, ...PASSES, ...PLANS, ...PACKS };
export const SKUS: readonly Sku[] = ["single", "season_returnship", "season_startup", "pro", "pack10", "pack40"];
/** What is on sale: one application, or a season pass. */
export const PUBLIC_SKUS: readonly Sku[] = ["single", "season_returnship", "season_startup"];
/** Sold until 2026-11-03; still granted and honoured when Stripe reports one, never offered again. */
export const LEGACY_SKUS: readonly Sku[] = ["pro", "pack10", "pack40"];
export const PLAN_SKUS: readonly PlanSku[] = ["pro"];
export const PACK_SKUS: readonly PackSku[] = ["pack10", "pack40"];
export const PASS_SKUS: readonly PassSku[] = ["season_returnship", "season_startup"];

export function isPassSku(v: unknown): v is PassSku {
  return typeof v === "string" && (PASS_SKUS as readonly string[]).includes(v);
}
export function isSingleSku(v: unknown): v is SingleSku {
  return v === "single";
}
export function isPublicSku(v: unknown): v is Sku {
  return typeof v === "string" && (PUBLIC_SKUS as readonly string[]).includes(v);
}

/** A pass's deadline line while product email is off: the reminders are in the app until then. */
export const DEADLINE_IN_APP: Localized = {
  en: "Deadline reminders in the app for the programmes you saved or started (email reminders coming soon)",
  zh: "你收藏或开始申请的项目，截止前在站内提醒（邮件提醒即将上线）",
};

/** An offer's feature lines as they are true today: without product email, deadline reminders are in-app. */
export function offerFeatures(offer: Offer, locale: Locale, opts: { mailer: boolean }): string[] {
  return offer.features[locale].map((line) => (!opts.mailer && offer.perks.deadlineEmails && /email|邮件/i.test(line) ? DEADLINE_IN_APP[locale] : line));
}

/** The season pass whose credits carry this scope (a lot's `scope`), if any. */
export function passForScope(scope: readonly string[] | null | undefined): PassSku | null {
  if (!scope?.length) return null;
  const key = [...scope].sort().join(",");
  return PASS_SKUS.find((sku) => [...(PASSES[sku].scope ?? [])].sort().join(",") === key) ?? null;
}

/** Whether credits scoped to `scope` (empty = any) may pay for an application of this opportunity type. */
export function scopeCovers(scope: readonly string[] | null | undefined, opportunityType: string | null | undefined): boolean {
  if (!scope || !scope.length) return true;
  return Boolean(opportunityType && scope.includes(opportunityType));
}

export function isSku(v: unknown): v is Sku {
  return typeof v === "string" && (SKUS as readonly string[]).includes(v);
}
export function isPlanSku(v: unknown): v is PlanSku {
  return typeof v === "string" && (PLAN_SKUS as readonly string[]).includes(v);
}

/**
 * Free credits granted on first sign-in: none since 2026-11-03 (Claude only writes for paid
 * applications; the free preview needs no credit). Kept as a constant so an earlier trial lot
 * still reads correctly and the owner can switch it back on in one place.
 */
export const TRIAL = { credits: 0, expiryDays: 60 } as const;

/** What one credit buys, by action. Practice applications and follow-ups are free. */
export const CREDIT_COST = {
  /** Unlocking one application (written in full, downloadable, submittable). */
  unlockApplication: 1,
  submitApplication: 1,
  outreachNewContact: 1,
  followUp: 0,
  practice: 0,
} as const;

/** The one-time price of unlocking an application, formatted ("$19"). */
export const UNLOCK_PRICE = formatPrice(SINGLE.priceUsd);

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
      "The preview of any application is free: your documents drafted from your own files, the first part readable, no account needed.",
      `Unlocking an application costs ${UNLOCK_PRICE} once, or one credit of a season pass. Unlocked, it is written in full with Claude, downloadable as Word and PDF, copyable answer by answer, and submitted or handed over with everything prepared.`,
      "Finding and ranking opportunities, your profile, follow-ups and practice applications are always free.",
      "A season pass lasts 90 days and pays only for its own kind of programme (returnships, or accelerators and startup competitions); it is used first for those.",
      "An unlock is spent the moment it is used; withdrawing the application afterwards does not return it. Revisions of an unlocked application are unlimited.",
      "Credits bought before November 2026 (Pro months, packs) keep working as unlocks until they expire.",
    ],
    zh: [
      "任何申请的预览都免费：材料依据你自己的文件起草，开头部分可读，无需注册。",
      `解锁一份申请一次 ${UNLOCK_PRICE}，或用申请季通行证的 1 个额度。解锁后由 Claude 完整写成，可下载 Word 和 PDF，逐项复制回答，并由我们提交或准备好逐步交接。`,
      "找机会、排序、你的档案、跟进邮件和练习申请永远免费。",
      "申请季通行证 90 天内有效，只用于对应类型的项目（返岗项目，或加速器与创业比赛），申请这类项目时优先使用。",
      "解锁即扣除，之后撤回申请不退回；已解锁申请的修改不限次数。",
      "2026 年 11 月前购买的额度（Pro 月度额度、额度包）在到期前仍可用于解锁。",
    ],
  },
};

/* ------------------------------------------------------------------ helpers (P4) */

/** Perks of an account without a plan (trial and pack credits only). */
export const NO_PLAN_PERKS: Offer["perks"] = { autoFollowUps: false, weeklyDigest: false };

/** The offer's display name in a locale ("Pro", "10 credits" / "Pro 会员", "10 个额度"). */
export function offerName(sku: Sku, locale: Locale): string {
  return OFFERS[sku].name[locale] ?? OFFERS[sku].name.en;
}

/** Days a sku's credits stay usable: after each billing period (plans) or after purchase (packs, passes). */
export function validityDays(sku: Sku): number {
  return OFFERS[sku].rolloverDays;
}
