import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TYPE_ICONS } from "@/components/site/TypeIcon";
import { AUDIENCE_CONTENT, audienceContent } from "@/content/audiences";
import { FAQS, FAQ_GROUPS, FAQ_GROUP_LABELS, HOME_FAQ_IDS, faqsByGroup, faqsById } from "@/content/faq";
import { PACKS, PLANS, TRIAL } from "@/content/plans";
import { ABOUT, BOUNDARY, CHANNEL_PLAIN, DRAFT_LABELS, FREE_INCLUDES, HANDOFF, HOME_TYPES, PRINCIPLES, SAFETY_RULES, STEPS, pick, todoZh } from "@/content/site-copy";
import { AUDIENCES, audienceKey } from "@/i18n/site-nav";
import { CHANNEL_IDS, OPPORTUNITY_TYPES, isOpportunityTypeId } from "@/lib/core";

const ROOT = path.resolve(import.meta.dirname, "..");

type Bi = { en: string; zh: string };

/** Every bilingual leaf in a value (deep). */
function bilinguals(value: unknown, out: Bi[] = []): Bi[] {
  if (Array.isArray(value)) value.forEach((v) => bilinguals(v, out));
  else if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    if (typeof o.en === "string" && typeof o.zh === "string" && Object.keys(o).length === 2) out.push(o as Bi);
    else Object.values(o).forEach((v) => bilinguals(v, out));
  }
  return out;
}

/** Routes this build serves (or that sibling areas serve), for checking internal links in content. */
const KNOWN_PATHS = [
  "/",
  "/how-it-works",
  "/pricing",
  "/faq",
  "/about",
  "/contact",
  "/privacy",
  "/terms",
  "/acceptable-use",
  "/cookie-policy",
  "/refund-policy",
  "/opportunities",
  "/app/start",
  ...AUDIENCES.map((a) => `/for/${a}`),
];

const ALL_COPY = { STEPS, BOUNDARY, PRINCIPLES, CHANNEL_PLAIN, HANDOFF, SAFETY_RULES, DRAFT_LABELS, ABOUT, FREE_INCLUDES, AUDIENCE_CONTENT, FAQS, FAQ_GROUP_LABELS };

describe("bilingual copy", () => {
  const all = bilinguals(ALL_COPY);

  it("finds a substantial amount of copy", () => {
    expect(all.length).toBeGreaterThan(300);
  });

  it("has real English everywhere and a Chinese placeholder (or translation) for every string", () => {
    for (const b of all) {
      expect(b.en.trim().length, JSON.stringify(b)).toBeGreaterThan(0);
      expect(b.zh.trim().length, JSON.stringify(b)).toBeGreaterThan(0);
      expect(b.en).not.toMatch(/lorem|ipsum|TODO|TBD|xxx/i);
    }
  });

  it("never invents social proof", () => {
    for (const b of all) {
      expect(b.en, b.en).not.toMatch(/\b(thousands of (users|people)|trusted by|5-star|rated \d|testimonial)\b/i);
      expect(b.en, b.en).not.toMatch(/\bguarantee(d|s)?\b(?! I'll| outcomes)/i);
    }
  });

  it("todoZh repeats the English and pick() reads a locale", () => {
    const l = todoZh("Hello");
    expect(l).toEqual({ en: "Hello", zh: "Hello" });
    expect(pick({ en: "A", zh: "甲" }, "zh")).toBe("甲");
    expect(pick({ en: "A", zh: "甲" }, "fr")).toBe("A");
  });
});

describe("site copy", () => {
  it("has the six steps of the plan, in order, with what you do and what we do", () => {
    expect(STEPS.map((s) => s.id)).toEqual(["drop", "profile", "goals", "tap", "prepare", "loop"]);
    for (const s of STEPS) {
      expect(s.you.en.length).toBeGreaterThan(40);
      expect(s.we.en.length).toBeGreaterThan(40);
    }
  });

  it("states the automation boundary of plan §12.1, including every step that stays with the person", () => {
    expect(BOUNDARY.length).toBeGreaterThanOrEqual(9);
    const text = BOUNDARY.map((r) => r.step.en).join(" | ");
    for (const word of [/CAPTCHA/, /log(ging)? in/i, /payment/i, /signature/i, /interview/i, /submitting/i, /email/i, /form/i]) expect(text).toMatch(word);
    expect(new Set(BOUNDARY.map((r) => r.tone))).toEqual(new Set(["auto", "tap", "you"]));
  });

  it("describes every channel in plain words, and says CH7 is not live", () => {
    expect(Object.keys(CHANNEL_PLAIN).sort()).toEqual([...CHANNEL_IDS].sort());
    expect(CHANNEL_PLAIN.CH7.en).toMatch(/not live/i);
    expect(CHANNEL_PLAIN.CH4.en).toMatch(/30 days/);
  });

  it("has three principles and honest draft labels", () => {
    expect(PRINCIPLES.map((p) => p.id)).toEqual(["true-facts", "your-tap", "your-data"]);
    expect(DRAFT_LABELS.local.label.en).toBe("Drafted from your profile");
    expect(DRAFT_LABELS.ai.label.en).toBe("Written with AI");
  });

  it("only shows real opportunity types on the home page", () => {
    for (const id of HOME_TYPES) expect(isOpportunityTypeId(id), id).toBe(true);
    expect(new Set(HOME_TYPES).size).toBe(HOME_TYPES.length);
  });

  it("has an icon for every opportunity type", () => {
    for (const t of OPPORTUNITY_TYPES) expect(TYPE_ICONS[t.icon], `${t.id} → ${t.icon}`).toBeTruthy();
  });

  it("never invents a team or a founder", () => {
    const about = bilinguals(ABOUT)
      .map((b) => b.en)
      .join(" ");
    expect(about).not.toMatch(/\b(our founders?|founded by|co-founder|CEO|our team of|headquartered)\b/i);
  });
});

describe("audiences", () => {
  it("has content for exactly the six audience pages", () => {
    expect(Object.keys(AUDIENCE_CONTENT).sort()).toEqual([...AUDIENCES].sort());
    for (const a of AUDIENCES) {
      expect(AUDIENCE_CONTENT[a].slug).toBe(a);
      expect(audienceContent(a)).toBe(AUDIENCE_CONTENT[a]);
      expect(audienceKey(a)).toBeTruthy();
    }
    expect(audienceContent("astronauts")).toBeNull();
  });

  it("gives every audience its own goals, types, worked example, uploads, week and handoffs", () => {
    for (const a of AUDIENCES) {
      const c = AUDIENCE_CONTENT[a];
      expect(c.goals.length, a).toBeGreaterThanOrEqual(4);
      expect(c.types.length, a).toBeGreaterThanOrEqual(8);
      expect(c.example.steps.length, a).toBeGreaterThanOrEqual(6);
      expect(c.uploads.length, a).toBeGreaterThanOrEqual(4);
      expect(c.weekly.length, a).toBeGreaterThanOrEqual(4);
      expect(c.yours.length, a).toBeGreaterThanOrEqual(4);
      expect(c.faqs.length, a).toBeGreaterThanOrEqual(2);
      for (const g of c.goals) for (const id of g.types) expect(isOpportunityTypeId(id), `${a}: ${id}`).toBe(true);
      for (const t of c.types) expect(isOpportunityTypeId(t.id), `${a}: ${t.id}`).toBe(true);
      expect(new Set(c.types.map((t) => t.id)).size, a).toBe(c.types.length);
      expect(c.metaDescription.en.length, a).toBeLessThanOrEqual(260);
    }
  });

  it("is written per audience, not one template with swapped nouns", () => {
    const fields = (pickField: (c: (typeof AUDIENCE_CONTENT)[keyof typeof AUDIENCE_CONTENT]) => string[]) =>
      AUDIENCES.flatMap((a) => pickField(AUDIENCE_CONTENT[a]));
    for (const values of [
      fields((c) => [c.title.en]),
      fields((c) => [c.lede.en]),
      fields((c) => [c.example.persona.en]),
      fields((c) => c.goals.map((g) => g.body.en)),
      fields((c) => c.weekly.map((w) => w.en)),
      fields((c) => c.example.steps.map((s) => s.text.en)),
    ]) {
      expect(new Set(values).size).toBe(values.length);
    }
    // Different audiences chase visibly different things.
    const sets = AUDIENCES.map((a) => new Set(AUDIENCE_CONTENT[a].types.map((t) => t.id)));
    for (let i = 0; i < sets.length; i++) {
      for (let j = i + 1; j < sets.length; j++) {
        const shared = [...sets[i]!].filter((id) => sets[j]!.has(id)).length;
        expect(shared, `${AUDIENCES[i]} vs ${AUDIENCES[j]}`).toBeLessThanOrEqual(4);
      }
    }
  });

  it("keeps worked examples free of real names and outcome numbers", () => {
    for (const a of AUDIENCES) {
      const text = AUDIENCE_CONTENT[a].example.steps.map((s) => s.text.en).join(" ");
      expect(text, a).not.toMatch(/\b(got|received|landed|won) (the|an?|\d+) (offer|interview|grant|place)/i);
      expect(text, a).not.toMatch(/%/);
    }
  });

  it("keeps the under-18 rule on the students page", () => {
    expect(AUDIENCE_CONTENT.students.note?.en).toMatch(/guardian/i);
  });
});

describe("FAQ", () => {
  it("has at least 24 questions in the six groups, at least three per group", () => {
    expect(FAQS.length).toBeGreaterThanOrEqual(24);
    expect([...FAQ_GROUPS]).toEqual(["how", "honesty", "data", "channels", "billing", "accounts"]);
    for (const g of FAQ_GROUPS) expect(faqsByGroup(g).length, g).toBeGreaterThanOrEqual(3);
  });

  it("uses unique, URL-safe anchors and existing pages", () => {
    const ids = FAQS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const f of FAQS) {
      expect(f.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      if (f.more) expect(KNOWN_PATHS, f.more.href).toContain(f.more.href.split("#")[0]);
    }
    expect(faqsById(HOME_FAQ_IDS).length).toBe(HOME_FAQ_IDS.length);
  });

  it("answers in plain text (they go into FAQPage JSON-LD verbatim)", () => {
    for (const f of FAQS) expect(f.a.en, f.id).not.toMatch(/\*\*|\]\(|<[a-z]/);
  });

  it("states credit numbers that match the pricing catalog", () => {
    const byId = new Map(FAQS.map((f) => [f.id, f.a.en]));
    expect(byId.get("free")).toContain(`${TRIAL.credits} credits, valid for ${TRIAL.expiryDays} days`);
    const expiry = byId.get("expiry") ?? "";
    expect(expiry).toContain(`${TRIAL.expiryDays} days`);
    expect(expiry).toContain(`${PLANS.pro.rolloverDays} days`);
    expect(expiry).toContain(`${PACKS.pack10.rolloverDays} days`);
    expect(PACKS.pack10.rolloverDays).toBe(PACKS.pack40.rolloverDays);
    expect(byId.get("refund")).toMatch(/14 days/);
  });
});

describe("message keys used by the P5a pages exist", () => {
  const site = JSON.parse(fs.readFileSync(path.join(ROOT, "messages/en/site.json"), "utf8")) as Record<string, unknown>;
  const common = JSON.parse(fs.readFileSync(path.join(ROOT, "messages/en/common.json"), "utf8")) as Record<string, unknown>;
  const has = (tree: Record<string, unknown>, key: string) =>
    key.split(".").reduce<unknown>((node, seg) => (node && typeof node === "object" ? (node as Record<string, unknown>)[seg] : undefined), tree) !== undefined;

  const PAGES = ["page.tsx", "how-it-works/page.tsx", "pricing/page.tsx", "for/[audience]/page.tsx", "faq/page.tsx", "about/page.tsx", "contact/page.tsx"];
  /** Helpers bound to a fixed prefix: d("x") → site.home.demo.x, f("x") → site.contact.form.x. */
  const HELPERS: Record<string, string> = { d: "site.home.demo", f: "site.contact.form" };
  const tree: Record<string, Record<string, unknown>> = { site, common };
  const resolves = (ns: string, key: string) => {
    const [file, ...rest] = ns.split(".");
    const root = tree[file!];
    return Boolean(root) && has(root!, [...rest, key].join("."));
  };

  for (const page of PAGES) {
    it(page, () => {
      const src = fs.readFileSync(path.join(ROOT, "src/app/[locale]/(site)", page), "utf8");
      // Every namespace the file asks for; a key must resolve under one of them.
      const namespaces = [...src.matchAll(/namespace:\s*"([a-zA-Z.]+)"/g)].map((m) => m[1]!);
      expect(namespaces.length).toBeGreaterThan(0);
      let checked = 0;
      for (const m of src.matchAll(/\b(t|tp|tcmp|tc|d|f)(?:\.rich|\.raw)?\(\s*["'`]([A-Za-z0-9_.]+)["'`]/g)) {
        const [, fn, key] = m;
        const ok = HELPERS[fn!] ? resolves(HELPERS[fn!]!, key!) : namespaces.some((ns) => resolves(ns, key!));
        expect(ok, `${fn}("${key}") in ${page}`).toBe(true);
        checked++;
      }
      expect(checked).toBeGreaterThan(3);
    });
  }
});
