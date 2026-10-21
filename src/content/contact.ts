/**
 * The contact form's topics and its input contract, shared by the form (client) and
 * POST /api/contact (server) so both validate the same way. Pure and isomorphic.
 *
 * Copy is bilingual: `bi("English", "中文")`. tests/i18n-parity.test.ts fails on English left in `zh`.
 */
import { z } from "zod";
import { bi, type Bilingual } from "./site-copy";

export const CONTACT_TOPICS = [
  { value: "application", label: bi("An application or a handoff", "某份申请或交接") },
  { value: "account", label: bi("My account or sign-in", "我的账户或登录") },
  { value: "billing", label: bi("Billing, credits or a refund", "账单、额度或退款") },
  { value: "privacy", label: bi("Privacy or my data", "隐私或我的数据") },
  { value: "opportunity", label: bi("Report or suggest an opportunity", "报告或推荐一个机会") },
  { value: "partnership", label: bi("Organisations and partnerships", "机构与合作") },
  { value: "press", label: bi("Press", "媒体") },
  { value: "other", label: bi("Something else", "其他事项") },
] as const satisfies readonly { value: string; label: Bilingual }[];

export type ContactTopic = (typeof CONTACT_TOPICS)[number]["value"];
export const CONTACT_TOPIC_VALUES = CONTACT_TOPICS.map((t) => t.value) as [ContactTopic, ...ContactTopic[]];

export function isContactTopic(v: unknown): v is ContactTopic {
  return typeof v === "string" && (CONTACT_TOPIC_VALUES as readonly string[]).includes(v);
}

export const CONTACT_LIMITS = { name: 120, email: 254, messageMin: 10, messageMax: 5000 } as const;

/** Machine-readable reasons the API answers with; the form shows its own localized sentence for each. */
export type ContactErrorCode = "invalid_email" | "message_short" | "message_long" | "invalid" | "rate_limited" | "server";

export const contactBodySchema = z.object({
  name: z.string().trim().max(CONTACT_LIMITS.name).optional().default(""),
  email: z.string().trim().toLowerCase().max(CONTACT_LIMITS.email).pipe(z.email()),
  topic: z.enum(CONTACT_TOPIC_VALUES).catch("other"),
  message: z.string().trim().min(CONTACT_LIMITS.messageMin).max(CONTACT_LIMITS.messageMax),
  locale: z.enum(["en", "zh"]).catch("en"),
  /** Honeypot: hidden from people, filled by bots. */
  website: z.string().max(500).optional().default(""),
});

export type ContactBody = z.infer<typeof contactBodySchema>;

export type ContactParse = { ok: true; data: ContactBody; bot: boolean } | { ok: false; code: ContactErrorCode };

/**
 * Validates a contact submission. A filled honeypot is reported as `bot: true` (the API then
 * answers with a quiet success and stores nothing).
 */
export function parseContact(input: unknown): ContactParse {
  const parsed = contactBodySchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path[0];
    if (field === "email") return { ok: false, code: "invalid_email" };
    if (field === "message") return { ok: false, code: issue?.code === "too_big" ? "message_long" : "message_short" };
    return { ok: false, code: "invalid" };
  }
  return { ok: true, data: parsed.data, bot: parsed.data.website.trim().length > 0 };
}

/** Client-side check before any network call, so the form can answer instantly. */
export function precheckContact(input: { email: string; message: string }): ContactErrorCode | null {
  const email = input.email.trim();
  if (!email || !z.email().safeParse(email.toLowerCase()).success || email.length > CONTACT_LIMITS.email) return "invalid_email";
  const message = input.message.trim();
  if (message.length < CONTACT_LIMITS.messageMin) return "message_short";
  if (message.length > CONTACT_LIMITS.messageMax) return "message_long";
  return null;
}

/** English sentences the API sends next to the code (the form prefers its localized copy). */
export const CONTACT_ERROR_TEXT: Record<ContactErrorCode, string> = {
  invalid_email: "Please enter a valid email address so we can reply.",
  message_short: "Please write at least a sentence.",
  message_long: "That message is longer than 5,000 characters. Please shorten it, or email us directly.",
  invalid: "Please check the form and try again.",
  rate_limited: "That's a lot of messages in a short time. Please wait a few minutes and try again.",
  server: "We couldn't send your message. Please email contact@onwardscout.com instead.",
};
