/**
 * The seven execution channels (build contract "Channels", plan §11.1) as honest, displayable data.
 * The implementations live in src/lib/channels (P3b); this file is what the UI says about them
 * and how they fall back. Nothing here claims more automation than the channel delivers.
 */
import { z } from "zod";
import { bi, bilingualSchema, localize, type Bilingual, type Locale } from "./labels";
import { CHANNEL_IDS, channelIdSchema, type ChannelId } from "./types";

/**
 * - confirm_then_auto: fully automatic after the person's confirmation tap (CH1, CH2).
 * - mostly_auto: automatic until a CAPTCHA / login / payment, then a handoff (CH3).
 * - auto_after_authorization: automatic once the person connects an account (CH4).
 * - auto: no action needed from the person (CH5, CH7).
 * - handoff: the person submits with everything prepared (CH6).
 */
export const CHANNEL_AUTOMATIONS = ["confirm_then_auto", "mostly_auto", "auto_after_authorization", "auto", "handoff"] as const;
export type ChannelAutomation = (typeof CHANNEL_AUTOMATIONS)[number];

export interface ChannelDef {
  id: ChannelId;
  label: Bilingual;
  description: Bilingual;
  automation: ChannelAutomation;
  /** What the person does, in one honest sentence. */
  userAction: Bilingual;
  /** Channels tried, in order, when this one cannot finish. */
  fallback: ChannelId[];
  /** `planned` channels are interfaces only (CH7 until partners onboard). */
  status: "live" | "planned";
  needsBrowser: boolean;
  /** Outreach on the person's behalf: never offered to minors (identity S1). */
  outreach: boolean;
}

export const channelDefSchema = z.object({
  id: channelIdSchema,
  label: bilingualSchema,
  description: bilingualSchema,
  automation: z.enum(CHANNEL_AUTOMATIONS),
  userAction: bilingualSchema,
  fallback: z.array(channelIdSchema),
  status: z.enum(["live", "planned"]),
  needsBrowser: z.boolean(),
  outreach: z.boolean(),
});

export const CHANNELS: readonly ChannelDef[] = [
  {
    id: "CH1",
    label: bi("ATS-aware", "ATS 直连"),
    description: bi(
      "Reads public Greenhouse, Lever and Ashby postings and their questions, so every answer is prepared without a browser.",
      "读取 Greenhouse、Lever、Ashby 的公开职位与申请问题，不开浏览器就能把每个答案准备好。",
    ),
    automation: "confirm_then_auto",
    userAction: bi(
      "Review the prepared application and tap Submit. If the form has a CAPTCHA or a login (or browser filling is off), you paste the prepared answers into the official form yourself — a few minutes.",
      "核对准备好的申请后点提交；如果表单有验证码或需要登录（或浏览器代填未开启），由你把准备好的答案粘贴到官方表单——大约几分钟。",
    ),
    fallback: ["CH3", "CH6"],
    status: "live",
    needsBrowser: false,
    outreach: false,
  },
  {
    id: "CH2",
    label: bi("Form adapter", "表单适配器"),
    description: bi(
      "Fills Google Forms and plain web forms field by field and keeps the confirmation page as evidence.",
      "逐项填写 Google 表单和普通网页表单，并保存确认页作为提交凭证。",
    ),
    automation: "confirm_then_auto",
    userAction: bi("Review the filled form and tap Submit.", "核对填好的表单，点提交。"),
    fallback: ["CH3", "CH6"],
    status: "live",
    needsBrowser: false,
    outreach: false,
  },
  {
    id: "CH3",
    label: bi("Browser agent", "通用浏览器代理"),
    description: bi(
      "Opens the official form in a browser, maps each field from your profile and logs every step with a screenshot.",
      "在浏览器中打开官方表单，按档案逐项填写，每一步都留有截图记录。",
    ),
    automation: "mostly_auto",
    userAction: bi(
      "Nothing until it meets a CAPTCHA, a login or a payment; then it hands over to you with everything ready.",
      "平时无需操作；遇到验证码、登录或付款时，会把准备好的内容交给你完成。",
    ),
    fallback: ["CH6"],
    status: "live",
    needsBrowser: true,
    outreach: false,
  },
  {
    id: "CH4",
    label: bi("Email outreach (your Gmail)", "邮件外联（你的 Gmail）"),
    description: bi(
      "Writes a personal email to each recipient and sends it from your own Gmail, with rate limits and follow-ups.",
      "为每位收件人单独撰写邮件，从你自己的 Gmail 发出，并控制频率、按时跟进。",
    ),
    automation: "auto_after_authorization",
    userAction: bi(
      "Connect Gmail once, then approve each email (or allow automatic follow-ups in Settings).",
      "授权一次 Gmail，之后逐封确认发送（也可以在设置里允许自动跟进）。",
    ),
    fallback: ["CH6"],
    status: "live",
    needsBrowser: false,
    outreach: true,
  },
  {
    id: "CH5",
    label: bi("Documents", "文书生成"),
    description: bi(
      "Drafts every document from your sourced facts and renders PDF, Word or slide notes.",
      "根据有出处的档案事实起草全部文书，并导出 PDF、Word 或演讲备注。",
    ),
    automation: "auto",
    userAction: bi("Check the draft against its sources and download it.", "对照来源核对草稿，然后下载。"),
    fallback: [],
    status: "live",
    needsBrowser: false,
    outreach: false,
  },
  {
    id: "CH6",
    label: bi("Handoff (you submit)", "本人协作（你来提交）"),
    description: bi(
      "For sites that need your own account or forbid automation: every field, file and step prepared in the form's order.",
      "适用于必须本人账号或禁止自动化的网站：按目标表单的顺序准备好每个字段、文件和步骤。",
    ),
    automation: "handoff",
    userAction: bi(
      "Copy each prepared field into the official site in order, then tap “I submitted it” — about five minutes.",
      "按顺序把准备好的内容复制到官方网站，完成后点「我已提交」，大约 5 分钟。",
    ),
    fallback: [],
    status: "live",
    needsBrowser: false,
    outreach: false,
  },
  {
    id: "CH7",
    label: bi("Partner API", "平台直连"),
    description: bi(
      "Direct submission to organisations that connect to Onward Scout. Not available yet.",
      "向接入 Onward Scout 的机构直接提交。暂未开放。",
    ),
    automation: "auto",
    userAction: bi("Nothing — partner organisations will receive your application directly.", "无需操作，合作机构会直接收到你的申请。"),
    fallback: ["CH2", "CH6"],
    status: "planned",
    needsBrowser: false,
    outreach: false,
  },
];

const BY_ID = new Map<string, ChannelDef>(CHANNELS.map((c) => [c.id, c]));

export function getChannel(id: ChannelId): ChannelDef {
  const def = BY_ID.get(id);
  if (!def) throw new Error(`Unknown channel: ${id}`);
  return def;
}

export function isChannelId(value: unknown): value is ChannelId {
  return typeof value === "string" && (CHANNEL_IDS as readonly string[]).includes(value);
}

export function channelLabel(id: ChannelId, locale: Locale | string): string {
  return localize(getChannel(id).label, locale);
}

/**
 * The ordered list of channels to try for a primary channel: itself, then its fallbacks
 * (transitively, without repeats). `planned` channels are skipped; outreach channels are
 * skipped when `allowOutreach` is false (minors).
 */
export function channelChain(primary: ChannelId, opts: { allowOutreach?: boolean } = {}): ChannelId[] {
  const allowOutreach = opts.allowOutreach ?? true;
  const out: ChannelId[] = [];
  const visit = (id: ChannelId) => {
    if (out.includes(id)) return;
    const def = getChannel(id);
    const usable = def.status === "live" && (allowOutreach || !def.outreach);
    if (usable) out.push(id);
    for (const next of def.fallback) visit(next);
  };
  visit(primary);
  if (!out.includes("CH6")) out.push("CH6");
  return out;
}
