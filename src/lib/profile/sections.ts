import { z } from "zod";
import { partialDateSchema } from "@/lib/core/types";

/*
 * What a fact path points at, and what "fix it" may change there — pure and shared by the
 * profile page (which inputs to show) and the facts route (what to accept).
 */

export type FixSection = "experience" | "education" | "projects" | "publications" | "achievements" | "certifications" | "skills" | "links" | "identity" | "summary";

export interface FixField {
  key: string;
  type: "text" | "date" | "year" | "url" | "textarea";
  required?: boolean;
}

export const FIX_FIELDS: Readonly<Record<Exclude<FixSection, "identity" | "summary">, readonly FixField[]>> = {
  experience: [
    { key: "title", type: "text", required: true },
    { key: "organization", type: "text", required: true },
    { key: "startDate", type: "date" },
    { key: "endDate", type: "date" },
    { key: "location", type: "text" },
  ],
  education: [
    { key: "institution", type: "text", required: true },
    { key: "degree", type: "text" },
    { key: "field", type: "text" },
    { key: "endDate", type: "date" },
  ],
  projects: [
    { key: "name", type: "text", required: true },
    { key: "role", type: "text" },
    { key: "url", type: "url" },
    { key: "summary", type: "textarea" },
  ],
  publications: [
    { key: "title", type: "text", required: true },
    { key: "venue", type: "text" },
    { key: "year", type: "year" },
  ],
  achievements: [
    { key: "title", type: "text", required: true },
    { key: "issuer", type: "text" },
    { key: "date", type: "date" },
  ],
  certifications: [
    { key: "name", type: "text", required: true },
    { key: "issuer", type: "text" },
    { key: "issuedAt", type: "date" },
  ],
  skills: [{ key: "name", type: "text", required: true }],
  links: [{ key: "url", type: "url", required: true }],
};

export interface PathTarget {
  section: FixSection;
  /** "item": an object in an array (by id or index); "scalar": one value. */
  shape: "item" | "scalar";
  fields: readonly FixField[];
}

const ITEM_SECTIONS = new Set(["experience", "education", "projects", "publications", "achievements", "certifications"]);
const SCALAR_IDENTITY = new Set(["name", "headline", "email", "phone", "location"]);

/** What a fact path can be fixed as, or null when it can't be edited in place. */
export function fixTarget(path: string): PathTarget | null {
  const segs = path.split("/").filter(Boolean);
  if (segs.length === 2 && ITEM_SECTIONS.has(segs[0]!)) {
    const section = segs[0] as keyof typeof FIX_FIELDS;
    return { section, shape: "item", fields: FIX_FIELDS[section] };
  }
  if (segs.length === 2 && segs[0] === "skills" && /^\d+$/.test(segs[1]!)) return { section: "skills", shape: "item", fields: FIX_FIELDS.skills };
  if (segs.length === 3 && segs[0] === "identity" && segs[1] === "links" && /^\d+$/.test(segs[2]!)) return { section: "links", shape: "item", fields: FIX_FIELDS.links };
  if (segs.length === 2 && segs[0] === "identity" && SCALAR_IDENTITY.has(segs[1]!)) {
    return { section: "identity", shape: "scalar", fields: [{ key: "value", type: "text", required: segs[1] === "name" }] };
  }
  if (segs.length === 1 && segs[0] === "summary") return { section: "summary", shape: "scalar", fields: [{ key: "value", type: "textarea" }] };
  return null;
}

const text = z.string().trim().max(300);
const optionalDate = z.union([partialDateSchema, z.literal(""), z.null()]).transform((v) => (v ? v : null));

/** Validates a fix for a target; returns the cleaned partial value. */
export function parseFix(target: PathTarget, raw: unknown): Record<string, unknown> | string | null {
  if (target.shape === "scalar") {
    const v = z.string().trim().max(target.section === "summary" ? 2000 : 300).safeParse(typeof raw === "object" && raw !== null ? (raw as { value?: unknown }).value : raw);
    if (!v.success) return null;
    if (target.fields[0]?.required && !v.data) return null;
    return v.data;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const input = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const f of target.fields) {
    if (!(f.key in input)) continue;
    const v = input[f.key];
    if (f.type === "date") {
      const d = optionalDate.safeParse(v === undefined ? null : v);
      if (!d.success) return null;
      out[f.key] = d.data;
    } else if (f.type === "year") {
      if (v === null || v === "") out[f.key] = null;
      else {
        const n = Number(v);
        if (!Number.isInteger(n) || n < 1900 || n > 2100) return null;
        out[f.key] = n;
      }
    } else {
      const s = (f.type === "textarea" ? z.string().trim().max(2000) : text).safeParse(v ?? "");
      if (!s.success) return null;
      if (f.type === "url" && s.data && !/^https?:\/\/\S+\.\S+/i.test(s.data) && !/^[\w.-]+\.[a-z]{2,}(\/\S*)?$/i.test(s.data)) return null;
      out[f.key] = s.data || null;
    }
    if (f.required && !out[f.key]) return null;
  }
  return Object.keys(out).length ? out : null;
}

/** One sentence for a corrected value, in the person's language. */
export function fixClaim(target: PathTarget, value: unknown, locale: "en" | "zh"): string {
  const zh = locale === "zh";
  const v = (value ?? {}) as Record<string, unknown>;
  const s = (x: unknown) => (typeof x === "string" ? x : x == null ? "" : String(x));
  let body: string;
  switch (target.section) {
    case "experience":
      body = zh ? `${s(v.organization)} ${s(v.title)}` : `${s(v.title)} at ${s(v.organization)}`;
      break;
    case "education":
      body = [s(v.degree), s(v.field), s(v.institution)].filter(Boolean).join(zh ? "，" : ", ");
      break;
    case "projects":
    case "certifications":
    case "skills":
      body = s(v.name);
      break;
    case "publications":
    case "achievements":
      body = s(v.title);
      break;
    case "links":
      body = s(v.url);
      break;
    default:
      body = s(value);
  }
  return zh ? `你确认/修改为：${body}` : `Confirmed by you: ${body}`;
}
