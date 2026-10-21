import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fillVars, isSafeHref, parseInline, plainInline, splitHash } from "@/components/site/inline-markup";
import { LEGAL_DOCS, LEGAL_DOC_KEYS, fillLegalDoc, legalDocStrings, legalVars, readLegalDoc, type LegalDoc } from "@/components/site/legal-doc";
import { THEME_KEY } from "@/components/theme";
import { PACKS, PLANS, TRIAL, formatPrice } from "@/content/plans";
import { mergeMessages } from "@/i18n/messages";
import { LOCALE_COOKIE } from "@/i18n/routing";
import { AUDIENCES } from "@/i18n/site-nav";
import { SITE } from "@/lib/site";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8")) as Record<string, unknown>;

const en = read("messages/en/legal.json");
const zh = mergeMessages(en, read("messages/zh/legal.json")) as Record<string, unknown>;

function doc(locale: "en" | "zh", key: (typeof LEGAL_DOC_KEYS)[number]): LegalDoc {
  return fillLegalDoc(readLegalDoc((locale === "en" ? en : zh)[key], `${locale}/${key}`), legalVars(locale));
}
const text = (d: LegalDoc) => legalDocStrings(d).join("\n");

const INTERNAL = new Set([
  "/",
  "/how-it-works",
  "/pricing",
  "/faq",
  "/about",
  "/contact",
  ...Object.values(LEGAL_DOCS),
  ...AUDIENCES.map((a) => `/for/${a}`),
]);

describe("inline markup", () => {
  it("parses bold, code and links, merging plain text", () => {
    expect(parseInline("Hello **world**, see `os_anon` and [terms](/terms).")).toEqual([
      { kind: "text", text: "Hello " },
      { kind: "bold", text: "world" },
      { kind: "text", text: ", see " },
      { kind: "code", text: "os_anon" },
      { kind: "text", text: " and " },
      { kind: "link", text: "terms", href: "/terms" },
      { kind: "text", text: "." },
    ]);
    expect(parseInline("plain")).toEqual([{ kind: "text", text: "plain" }]);
    expect(parseInline("")).toEqual([]);
  });

  it("refuses unsafe link targets and keeps their label as text", () => {
    expect(parseInline("[x](javascript:void)")).toEqual([{ kind: "text", text: "x" }]);
    expect(parseInline("[x](//evil.example) ok")).toEqual([{ kind: "text", text: "x ok" }]);
    for (const bad of ["//evil.example", "/\\evil", "http://plain.example", "javascript:alert(1)", "data:text/html,x", "mailto:nobody"]) {
      expect(isSafeHref(bad), bad).toBe(false);
    }
    for (const ok of ["/privacy", "/privacy#analytics", "#top", "https://example.com/a", "mailto:contact@onwardscout.com"]) {
      expect(isSafeHref(ok), ok).toBe(true);
    }
  });

  it("fills known placeholders only and strips markup for plain text", () => {
    expect(fillVars("Write to {email} about {unknown}.", { email: "a@b.co" })).toBe("Write to a@b.co about {unknown}.");
    expect(fillVars("{n} credits", { n: 3 })).toBe("3 credits");
    expect(plainInline("Read the **terms** and [privacy](/privacy).")).toBe("Read the terms and privacy.");
    expect(splitHash("/privacy#analytics")).toEqual({ path: "/privacy", hash: "#analytics" });
    expect(splitHash("/terms")).toEqual({ path: "/terms", hash: "" });
  });
});

describe("legal documents", () => {
  for (const locale of ["en", "zh"] as const) {
    for (const key of LEGAL_DOC_KEYS) {
      it(`${locale}/${key} is well-formed, fully filled, and only links where it may`, () => {
        const d = doc(locale, key);
        expect(d.sections.length).toBeGreaterThanOrEqual(3);
        for (const s of legalDocStrings(d)) {
          expect(s, s).not.toMatch(/\{[A-Za-z][A-Za-z0-9]*\}/); // every placeholder filled
          expect(s, s).not.toMatch(/lorem|TODO|TBD/i);
          for (const t of parseInline(s)) {
            if (t.kind !== "link") continue;
            if (t.href.startsWith("/")) expect(INTERNAL, t.href).toContain(splitHash(t.href).path);
            else expect(t.href).toBe(`mailto:${SITE.email}`);
          }
        }
      });
    }
  }

  it("rejects a malformed document with a readable error", () => {
    expect(() => readLegalDoc({ title: "x" }, "broken")).toThrow(/Legal document "broken" is malformed/);
    const raw = en.privacy as LegalDoc;
    const dup = { ...raw, sections: [raw.sections[0], raw.sections[0], raw.sections[1]] };
    expect(() => readLegalDoc(dup, "dup")).toThrow(/duplicate section id/);
  });

  it("fills prices and credit rules from the plans catalog", () => {
    const vars = legalVars("en");
    expect(vars.proPrice).toBe(formatPrice(PLANS.pro.priceUsd));
    expect(vars.trialCredits).toBe(TRIAL.credits);
    expect(vars.packDays).toBe(PACKS.pack10.rolloverDays);
    const terms = text(doc("en", "terms"));
    expect(terms).toContain(`Pro costs ${formatPrice(PLANS.pro.priceUsd)} per month for ${PLANS.pro.credits} credits`);
    expect(terms).toContain(`${TRIAL.credits} free credits, valid for ${TRIAL.expiryDays} days`);
  });

  it("privacy names every processor we run and the analytics deep capture", () => {
    const p = text(doc("en", "privacy"));
    for (const name of ["Clerk", "Neon", "Cloudflare R2", "Email Routing", "Vercel", "Stripe", "FlowGlance", "Anthropic", "Google", "gmail.send"]) {
      expect(p, name).toContain(name);
    }
    expect(p).toMatch(/text you type into forms/i);
    expect(p).toMatch(/images you upload/i);
    expect(p).toMatch(/EU and EEA, the UK and Switzerland/);
    expect(p).toMatch(/not used to train/i);
    expect(p).toMatch(/never read|can’t use\) access to read|cannot read|read your inbox/i);
    expect(p).toMatch(/us-east-1/);
    for (const law of ["GDPR", "UK GDPR", "CCPA", "Personal Information Protection Law", "PIPL"]) expect(p, law).toContain(law);
    expect(p).toMatch(/guardian/i);
    expect(p).toMatch(/Settings → download your data/);
    expect(p).toMatch(/Settings → delete account/);
    expect(p).toMatch(/drop-box/);
  });

  it("the cookie policy lists the cookies the code actually sets", () => {
    const c = text(doc("en", "cookies"));
    const consentSrc = fs.readFileSync(path.join(ROOT, "src/components/Consent.tsx"), "utf8");
    const consentCookie = /const COOKIE = "([^"]+)"/.exec(consentSrc)?.[1];
    expect(consentCookie).toBeTruthy();
    for (const name of [consentCookie!, LOCALE_COOKIE, THEME_KEY, "os_anon", "__session", "__client_uat"]) expect(c, name).toContain(name);
    expect(c).toMatch(/180 days/);
    expect(c).toMatch(/FlowGlance/);
    expect(c).toMatch(/Stripe/);
    expect(c).toMatch(/No advertising cookies/);
  });

  it("the terms carry the agency authorization and a neutral disputes clause", () => {
    const t = text(doc("en", "terms"));
    expect(t).toMatch(/act as your agent/);
    expect(t).toMatch(/after you confirm that application/);
    expect(t).toMatch(/standing authorization/);
    expect(t).toMatch(/responsible for the accuracy of what you approve/);
    expect(t).toMatch(/don’t guarantee/);
    expect(t).toMatch(/consumer protection laws of your country of residence/);
    expect(t).toContain(SITE.email);
    // No invented legal entity, registration or court.
    expect(t).not.toMatch(/\b(Ltd|Inc\.|LLC|GmbH|Pte|registered (office|address|in)|company number|courts of (Delaware|England|California|Singapore))\b/);
  });

  it("the refund policy states the 14-day rules and that failed submissions never cost a credit", () => {
    const r = text(doc("en", "refunds"));
    expect(r).toMatch(/Within 14 days of a Pro charge, if none of the credits from that charge have been used/);
    expect(r).toMatch(/A pack is refundable in full within 14 days of purchase if none of its credits have been used/);
    expect(r).toMatch(/failed submission never needs a refund/i);
    expect(r).toMatch(/keep Pro and its credits until the end of the period/);
    expect(r).toContain(SITE.email);
  });

  it("acceptable use covers false information, impersonation, consent, spam and scraping", () => {
    const a = text(doc("en", "acceptableUse"));
    for (const re of [/false or misleading/, /impersonate/, /documented consent/, /No bulk email/, /No scraping/]) expect(a).toMatch(re);
  });

  it("the shell has a label for every document", () => {
    const shell = en.shell as Record<string, string>;
    for (const key of LEGAL_DOC_KEYS) expect(shell[key], key).toBeTruthy();
  });
});
