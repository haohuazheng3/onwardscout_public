/**
 * The contact form's topics and its input contract, shared by the form (client) and
 * POST /api/contact (server) so both validate the same way. Pure and isomorphic.
 *
 * TODO-zh: `todoZh("…")` repeats the English as the Chinese placeholder until the translation pass.
 */
import { z } from "zod";
import { todoZh, type Bilingual } from "./site-copy";

export const CONTACT_TOPICS = [
  { value: "application", label: todoZh("An application or a handoff") },
  { value: "account", label: todoZh("My account or sign-in") },
  { value: "billing", label: todoZh("Billing, credits or a refund") },
  { value: "privacy", label: todoZh("Privacy or my data") },
  { value: "opportunity", label: todoZh("Report or suggest an opportunity") },
  { value: "partnership", label: todoZh("Organisations and partnerships") },
  { value: "press", label: todoZh("Press") },
  { value: "other", label: todoZh("Something else") },
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
