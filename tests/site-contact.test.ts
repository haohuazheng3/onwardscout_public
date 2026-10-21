import { describe, expect, it } from "vitest";
import { compareRows, perCreditLabel } from "@/components/site/pricing";
import { CONTACT_ERROR_TEXT, CONTACT_LIMITS, CONTACT_TOPICS, CONTACT_TOPIC_VALUES, isContactTopic, parseContact, precheckContact } from "@/content/contact";
import { PACKS, PLANS, TRIAL } from "@/content/plans";

const valid = { name: "Ada", email: "  Ada@Example.COM ", topic: "billing", message: "I was charged twice on Monday.", locale: "zh" };

describe("contact form contract", () => {
  it("accepts a valid message and normalises it", () => {
    const r = parseContact(valid);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.bot).toBe(false);
    expect(r.data).toMatchObject({ name: "Ada", email: "ada@example.com", topic: "billing", locale: "zh", website: "" });
  });

  it("falls back to safe defaults for unknown topics and locales, and an empty name", () => {
    const r = parseContact({ email: "a@b.co", message: "Hello there, a question.", topic: "hack", locale: "fr" });
    expect(r.ok && r.data.topic).toBe("other");
    expect(r.ok && r.data.locale).toBe("en");
    expect(r.ok && r.data.name).toBe("");
  });

  it("reports each problem with a code the form can localize", () => {
    expect(parseContact({ ...valid, email: "not-an-email" })).toEqual({ ok: false, code: "invalid_email" });
    expect(parseContact({ ...valid, email: undefined })).toEqual({ ok: false, code: "invalid_email" });
    expect(parseContact({ ...valid, message: "short" })).toEqual({ ok: false, code: "message_short" });
    expect(parseContact({ ...valid, message: "x".repeat(CONTACT_LIMITS.messageMax + 1) })).toEqual({ ok: false, code: "message_long" });
    expect(parseContact({ ...valid, name: "x".repeat(CONTACT_LIMITS.name + 1) })).toEqual({ ok: false, code: "invalid" });
    expect(parseContact(null)).toEqual({ ok: false, code: "invalid" });
  });

  it("flags a filled honeypot as a bot", () => {
    const r = parseContact({ ...valid, website: "https://spam.example" });
    expect(r.ok && r.bot).toBe(true);
  });

  it("prechecks on the client with the same rules", () => {
    expect(precheckContact({ email: "a@b.co", message: "Long enough message." })).toBeNull();
    expect(precheckContact({ email: "", message: "Long enough message." })).toBe("invalid_email");
    expect(precheckContact({ email: "a@b", message: "Long enough message." })).toBe("invalid_email");
    expect(precheckContact({ email: "a@b.co", message: "   hi   " })).toBe("message_short");
    expect(precheckContact({ email: "a@b.co", message: "y".repeat(5001) })).toBe("message_long");
  });

  it("has a sentence for every error code and a label for every topic", () => {
    for (const code of ["invalid_email", "message_short", "message_long", "invalid", "rate_limited", "server"] as const) {
      expect(CONTACT_ERROR_TEXT[code].length).toBeGreaterThan(10);
    }
    expect(CONTACT_TOPIC_VALUES).toContain("other");
    expect(new Set(CONTACT_TOPIC_VALUES).size).toBe(CONTACT_TOPICS.length);
    expect(isContactTopic("privacy")).toBe(true);
    expect(isContactTopic("nope")).toBe(false);
    expect(isContactTopic(null)).toBe(false);
  });
});

describe("pricing comparison", () => {
  const t = (key: string, values?: Record<string, string | number>) => (values ? `${key}:${JSON.stringify(values)}` : key);
  const rows = compareRows(t);
  const row = (id: string) => rows.find((r) => r.id === id)!;

  it("derives credit amounts and validity from the catalog", () => {
    expect(row("credits").free).toEqual({ kind: "text", text: `creditsFree:${JSON.stringify({ credits: TRIAL.credits, days: TRIAL.expiryDays })}` });
    expect(row("credits").pro).toEqual({ kind: "text", text: `creditsPro:${JSON.stringify({ credits: PLANS.pro.credits, days: PLANS.pro.rolloverDays })}` });
    expect(row("credits").packs).toEqual({
      kind: "text",
      text: `creditsPacks:${JSON.stringify({ small: PACKS.pack10.credits, large: PACKS.pack40.credits, days: PACKS.pack10.rolloverDays })}`,
    });
  });

  it("gives Pro its perks and keeps the free core free everywhere", () => {
    // The brief is in the app for everyone; its email copy is the Pro perk ("coming soon" until email is on).
    for (const col of ["free", "packs", "pro"] as const) expect(row("digest")[col].kind).toBe("yes");
    expect(row("digestEmail").free.kind).toBe("no");
    expect(row("digestEmail").packs.kind).toBe(PACKS.pack10.perks.weeklyDigest ? "yes" : "no");
    expect(row("digestEmail").pro).toEqual(PLANS.pro.perks.weeklyDigest ? { kind: "text", text: "comingSoon" } : { kind: "no" });
    expect(rows.some((r) => r.id === "priority")).toBe(false);
    expect(row("followups").pro).toEqual({ kind: "text", text: "followUpsAuto" });
    expect(row("followups").free).toEqual({ kind: "text", text: "followUpsTap" });
    for (const id of ["core", "practice", "channels"]) {
      expect([row(id).free.kind, row(id).packs.kind, row(id).pro.kind]).toEqual(["yes", "yes", "yes"]);
    }
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
  });

  it("prices one credit to the cent", () => {
    expect(perCreditLabel(PACKS.pack10)).toBe("$0.90");
    expect(perCreditLabel(PACKS.pack40)).toBe("$0.73");
    expect(perCreditLabel(PLANS.pro)).toBe("$0.48");
  });
});
