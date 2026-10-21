import { z } from "zod";
import { functionLabel } from "@/lib/core/functions";
import { identityLabel, isValidStage } from "@/lib/core/identities";
import { industryLabel, isIndustryCode } from "@/lib/core/industries";
import { isOccupationCode, occupationLabel } from "@/lib/core/occupations";
import { countryCodeSchema, functionIdSchema, identityCodeSchema, remotePreferenceSchema, WORK_AUTH_STATUSES, type Locale, type Profile } from "@/lib/core";
import { applyGapAnswer, GAP_IDS, type GapId } from "./gaps";
import { setAt } from "./merge";

/*
 * The edits a person makes by tapping (step 2 of /app/start and the profile page). Every
 * patch is validated here, applied to the profile purely, and turned into user-confirmed
 * facts so later extractions never overwrite what the person chose.
 */

const REMOTE_LABEL: Record<string, { en: string; zh: string }> = {
  remote_only: { en: "remote only", zh: "只要远程" },
  remote_ok: { en: "remote or on-site", zh: "远程或到岗都行" },
  onsite_only: { en: "on-site only", zh: "只要到岗" },
};

const AUTH_LABEL: Record<(typeof WORK_AUTH_STATUSES)[number], { en: string; zh: string }> = {
  citizen: { en: "citizen", zh: "公民" },
  permanent_resident: { en: "permanent resident", zh: "永久居民" },
  work_visa: { en: "work visa", zh: "工作签证" },
  student_visa: { en: "student visa", zh: "学生签证" },
  dependent_visa: { en: "dependent visa", zh: "家属签证" },
  needs_sponsorship: { en: "needs visa sponsorship", zh: "需要签证担保" },
  other: { en: "other status", zh: "其他身份" },
};

/** Identity fields a person may set or fix directly. */
export const EDITABLE_IDENTITY_FIELDS = ["name", "headline", "email", "phone", "location", "guardianEmail"] as const;

export const profilePatchSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("roles"),
    roles: z.array(z.object({ code: identityCodeSchema, stage: z.string().max(40).nullable().optional() })).max(8),
  }),
  z.object({ op: z.literal("industries"), codes: z.array(z.string().max(80)).max(8) }),
  z.object({ op: z.literal("functions"), ids: z.array(functionIdSchema).max(6) }),
  z.object({ op: z.literal("occupations"), codes: z.array(z.string().max(80)).max(5) }),
  z.object({
    op: z.literal("location"),
    location: z.string().trim().min(1).max(120),
    city: z.string().trim().max(80).nullable().optional(),
    countryCode: countryCodeSchema.nullable().optional(),
  }),
  z.object({ op: z.literal("remote"), value: remotePreferenceSchema }),
  z.object({
    op: z.literal("workAuthorization"),
    items: z.array(z.object({ countryCode: countryCodeSchema, status: z.enum(WORK_AUTH_STATUSES) })).max(4),
  }),
  z.object({ op: z.literal("answer"), questionId: z.enum(GAP_IDS), values: z.array(z.string().max(80)).min(1).max(5) }),
  z.object({ op: z.literal("field"), field: z.enum(EDITABLE_IDENTITY_FIELDS), value: z.string().trim().max(300) }),
  z.object({ op: z.literal("confirm") }),
]);
export type ProfilePatch = z.infer<typeof profilePatchSchema>;

export interface PatchFact {
  path: string;
  value: unknown;
  claim: string;
}

export interface PatchResult {
  profile: Profile;
  facts: PatchFact[];
  /** True for the "looks right" confirmation (profile status → confirmed). */
  confirm: boolean;
}

export class PatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PatchError";
  }
}

const said = (locale: Locale, en: string, zh: string) => (locale === "zh" ? zh : en);

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Applies one tap. Pure; throws PatchError with a human sentence for invalid input. */
export function applyProfilePatch(profile: Profile, patch: ProfilePatch, opts: { locale?: Locale; now?: Date } = {}): PatchResult {
  const locale = opts.locale ?? "en";
  const sep = locale === "zh" ? "、" : ", ";
  switch (patch.op) {
    case "roles": {
      const seen = new Set<string>();
      const roles = patch.roles
        .filter((r) => (seen.has(r.code) ? false : (seen.add(r.code), true)))
        .map((r) => {
          const prev = profile.roles.find((x) => x.code === r.code);
          const stage = r.stage === undefined ? (prev?.stage ?? null) : r.stage;
          if (stage !== null && !isValidStage(r.code, stage)) throw new PatchError("That stage doesn't fit the identity you picked.");
          return { code: r.code, stage, since: prev?.since ?? null, inferred: false };
        });
      const names = roles.map((r) => identityLabel(r.code, locale)).join(sep);
      return {
        profile: { ...profile, roles },
        facts: [{ path: "/roles", value: roles.map((r) => ({ code: r.code, stage: r.stage })), claim: roles.length ? said(locale, `You are: ${names}`, `你的身份：${names}`) : said(locale, "No identity picked yet", "还没有选择身份") }],
        confirm: false,
      };
    }
    case "industries": {
      const codes = [...new Set(patch.codes)];
      if (codes.some((c) => !isIndustryCode(c))) throw new PatchError("One of those industries isn't in our list.");
      const names = codes.map((c) => industryLabel(c, locale)).join(sep);
      return { profile: { ...profile, industries: codes }, facts: [{ path: "/industries", value: codes, claim: said(locale, `Industries: ${names || "none"}`, `行业：${names || "无"}`) }], confirm: false };
    }
    case "functions": {
      const ids = [...new Set(patch.ids)];
      const names = ids.map((c) => functionLabel(c, locale)).join(sep);
      return { profile: { ...profile, functions: ids }, facts: [{ path: "/functions", value: ids, claim: said(locale, `Functions: ${names || "none"}`, `职能：${names || "无"}`) }], confirm: false };
    }
    case "occupations": {
      const codes = [...new Set(patch.codes)];
      if (codes.some((c) => !isOccupationCode(c))) throw new PatchError("One of those occupations isn't in our list.");
      const names = codes.map((c) => occupationLabel(c, locale)).join(sep);
      return { profile: { ...profile, occupations: codes }, facts: [{ path: "/occupations", value: codes, claim: said(locale, `Occupation: ${names || "none"}`, `职业：${names || "无"}`) }], confirm: false };
    }
    case "location": {
      const identity = { ...profile.identity, location: patch.location, city: patch.city ?? patch.location.split(/[,，]/)[0]!.trim() ?? null, countryCode: patch.countryCode ?? null };
      return {
        profile: { ...profile, identity },
        facts: [{ path: "/identity/location", value: { location: identity.location, city: identity.city, countryCode: identity.countryCode }, claim: said(locale, `Based in ${patch.location}`, `所在地：${patch.location}`) }],
        confirm: false,
      };
    }
    case "remote": {
      let p = profile;
      if (!p.packs.jobSeeker) p = setAt(p, "/packs/jobSeeker", { targetFunctions: [], targetOccupations: [], targetIndustries: [], locations: [], remote: null, salaryMin: null, salaryMax: null, currency: null, salaryPeriod: null, availableFrom: null, needsSponsorship: null, searchVisibility: null });
      p = setAt(p, "/packs/jobSeeker/remote", patch.value);
      const l = REMOTE_LABEL[patch.value]!;
      return { profile: p, facts: [{ path: "/packs/jobSeeker/remote", value: patch.value, claim: said(locale, `Work setup: ${l.en}`, `工作方式：${l.zh}`) }], confirm: false };
    }
    case "workAuthorization": {
      const seen = new Set<string>();
      const items = patch.items.filter((i) => (seen.has(i.countryCode) ? false : (seen.add(i.countryCode), true))).map((i) => ({ countryCode: i.countryCode, status: i.status, note: null }));
      const names = items.map((i) => `${i.countryCode} ${locale === "zh" ? AUTH_LABEL[i.status].zh : AUTH_LABEL[i.status].en}`).join(sep);
      let p: Profile = { ...profile, identity: { ...profile.identity, workAuthorization: items } };
      // Sponsorship is what employers filter on: keep the job-seeker pack in step.
      if (p.packs.jobSeeker || items.some((i) => i.status === "needs_sponsorship")) {
        if (!p.packs.jobSeeker) p = setAt(p, "/packs/jobSeeker", { targetFunctions: [], targetOccupations: [], targetIndustries: [], locations: [], remote: null, salaryMin: null, salaryMax: null, currency: null, salaryPeriod: null, availableFrom: null, needsSponsorship: null, searchVisibility: null });
        p = setAt(p, "/packs/jobSeeker/needsSponsorship", items.some((i) => i.status === "needs_sponsorship"));
      }
      return { profile: p, facts: [{ path: "/identity/workAuthorization", value: items, claim: said(locale, `Work authorization: ${names || "not given"}`, `工作许可：${names || "未填写"}`) }], confirm: false };
    }
    case "answer": {
      const r = applyGapAnswer(profile, patch.questionId as GapId, patch.values, { locale, now: opts.now });
      return { profile: r.profile, facts: [r.fact], confirm: false };
    }
    case "field": {
      const value = patch.value.trim();
      if ((patch.field === "email" || patch.field === "guardianEmail") && value && !EMAIL.test(value)) throw new PatchError("That email address doesn't look right.");
      const identity = { ...profile.identity, [patch.field]: value || null };
      if (patch.field === "location") identity.city = value ? (value.split(/[,，]/)[0]?.trim() ?? null) : null;
      const labels: Record<(typeof EDITABLE_IDENTITY_FIELDS)[number], [string, string]> = {
        name: ["Name", "姓名"],
        headline: ["Headline", "一句话介绍"],
        email: ["Email", "邮箱"],
        phone: ["Phone", "电话"],
        location: ["Based in", "所在地"],
        guardianEmail: ["Guardian's email", "监护人邮箱"],
      };
      const [en, zh] = labels[patch.field];
      return { profile: { ...profile, identity }, facts: [{ path: `/identity/${patch.field}`, value: value || null, claim: said(locale, `${en}: ${value || "removed"}`, `${zh}：${value || "已删除"}`) }], confirm: false };
    }
    case "confirm":
      return { profile, facts: [], confirm: true };
  }
}
