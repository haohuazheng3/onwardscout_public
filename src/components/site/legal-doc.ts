/**
 * The shape of a legal document in messages/<locale>/legal.json and the values its `{name}`
 * placeholders are filled with. Pure: the pages parse with it, and tests validate every
 * document in both locales against it.
 */
import { z } from "zod";
import { PACKS, PLANS, TRIAL, formatPrice } from "@/content/plans";
import { CONTENT_UPDATED, SITE, SITE_ZH, type Locale } from "@/lib/site";
import { fillVars } from "./inline-markup";

const text = z.string().trim().min(1);

export const legalBlockSchema = z.union([
  text,
  z.object({ h3: text }).strict(),
  z.object({ note: text }).strict(),
  z.object({ ul: z.array(text).min(1) }).strict(),
  z
    .object({
      table: z.object({
        head: z.array(text).min(2),
        rows: z.array(z.array(text).min(2)).min(1),
      }),
    })
    .strict(),
]);

export const legalSectionSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  title: text,
  body: z.array(legalBlockSchema).min(1),
});

export const legalDocSchema = z
  .object({
    metaTitle: text,
    metaDescription: text,
    title: text,
    summary: z.array(text).min(1),
    sections: z.array(legalSectionSchema).min(3),
  })
  .superRefine((doc, ctx) => {
    const seen = new Set<string>();
    for (const s of doc.sections) {
      if (seen.has(s.id)) ctx.addIssue({ code: "custom", message: `duplicate section id "${s.id}"` });
      seen.add(s.id);
    }
    for (const s of doc.sections) {
      for (const b of s.body) {
        if (typeof b === "object" && "table" in b) {
          const width = b.table.head.length;
          if (b.table.rows.some((r) => r.length !== width)) {
            ctx.addIssue({ code: "custom", message: `table in "${s.id}" has rows that don't match its header` });
          }
        }
      }
    }
  });

export type LegalBlock = z.infer<typeof legalBlockSchema>;
export type LegalSection = z.infer<typeof legalSectionSchema>;
export type LegalDoc = z.infer<typeof legalDocSchema>;

/** Keys of the five documents inside the `legal` namespace, and their public paths. */
export const LEGAL_DOCS = {
  privacy: "/privacy",
  terms: "/terms",
  acceptableUse: "/acceptable-use",
  cookies: "/cookie-policy",
  refunds: "/refund-policy",
} as const;
export type LegalDocKey = keyof typeof LEGAL_DOCS;
export const LEGAL_DOC_KEYS = Object.keys(LEGAL_DOCS) as LegalDocKey[];

/** Values every legal text may reference as `{name}`; they come from the single sources of truth. */
export function legalVars(locale: Locale): Record<string, string | number> {
  return {
    email: SITE.email,
    domain: SITE.domain,
    replyTime: locale === "zh" ? SITE_ZH.replyTime : SITE.replyTime,
    updated: CONTENT_UPDATED,
    trialCredits: TRIAL.credits,
    trialDays: TRIAL.expiryDays,
    proPrice: formatPrice(PLANS.pro.priceUsd),
    proCredits: PLANS.pro.credits,
    proRollover: PLANS.pro.rolloverDays,
    pack10Price: formatPrice(PACKS.pack10.priceUsd),
    pack10Credits: PACKS.pack10.credits,
    pack40Price: formatPrice(PACKS.pack40.priceUsd),
    pack40Credits: PACKS.pack40.credits,
    packDays: PACKS.pack10.rolloverDays,
  };
}

/** Parses one document; throws with a readable message so a broken translation fails the build loudly. */
export function readLegalDoc(raw: unknown, label: string): LegalDoc {
  const parsed = legalDocSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new Error(`Legal document "${label}" is malformed at ${first?.path.join(".") || "(root)"}: ${first?.message ?? "invalid"}`);
  }
  return parsed.data;
}

/** Every string a document renders, in order (for tests: placeholders, forbidden words). */
export function legalDocStrings(doc: LegalDoc): string[] {
  const out: string[] = [doc.metaTitle, doc.metaDescription, doc.title, ...doc.summary];
  for (const s of doc.sections) {
    out.push(s.title);
    for (const b of s.body) {
      if (typeof b === "string") out.push(b);
      else if ("h3" in b) out.push(b.h3);
      else if ("note" in b) out.push(b.note);
      else if ("ul" in b) out.push(...b.ul);
      else out.push(...b.table.head, ...b.table.rows.flat());
    }
  }
  return out;
}

/** The document with every `{name}` placeholder filled (pure; unknown names stay visible). */
export function fillLegalDoc(doc: LegalDoc, vars: Readonly<Record<string, string | number>>): LegalDoc {
  const f = (s: string) => fillVars(s, vars);
  return {
    metaTitle: f(doc.metaTitle),
    metaDescription: f(doc.metaDescription),
    title: f(doc.title),
    summary: doc.summary.map(f),
    sections: doc.sections.map((s) => ({
      id: s.id,
      title: f(s.title),
      body: s.body.map((b): LegalBlock => {
        if (typeof b === "string") return f(b);
        if ("h3" in b) return { h3: f(b.h3) };
        if ("note" in b) return { note: f(b.note) };
        if ("ul" in b) return { ul: b.ul.map(f) };
        return { table: { head: b.table.head.map(f), rows: b.table.rows.map((r) => r.map(f)) } };
      }),
    })),
  };
}
