import type { Profile } from "@/lib/core/types";
import type { FactRef } from "../types";
import { totalYears } from "./text";

/*
 * The composer's only window on the person: profile values that are backed by a fact.
 * A value without a fact behind it (or a confirmed answer) is treated as unknown, so every
 * sentence the local engine writes can list the fact ids it rests on.
 *
 * Fact paths are JSON pointers into the profile; a fact on an item (`/experience/<id>`)
 * covers its fields, and a fact on a field (`/experience/<id>/title`) supports its item.
 */

export interface Backed<T> {
  value: T;
  ids: string[];
}

type Exp = Profile["experience"][number];
type Edu = Profile["education"][number];
type Proj = Profile["projects"][number];
type Pub = Profile["publications"][number];
type Ach = Profile["achievements"][number];
type Cert = Profile["certifications"][number];
type Ven = NonNullable<Profile["packs"]["founder"]>["ventures"][number];

function stripLabel(claim: string): string {
  return claim.replace(/^[^:：]{1,24}[:：]\s*/, "").trim();
}

export class FactView {
  readonly profile: Profile;
  private readonly facts: FactRef[];
  private readonly byPath = new Map<string, FactRef[]>();

  constructor(profile: Profile, facts: FactRef[]) {
    this.profile = profile;
    // Low-confidence, unconfirmed facts (unverifiable quotes) are not used for writing.
    this.facts = facts.filter((f) => f.confirmedByUser || (f.confidence ?? 1) >= 0.4);
    for (const f of this.facts) {
      const list = this.byPath.get(f.path) ?? [];
      list.push(f);
      this.byPath.set(f.path, list);
    }
  }

  /** Ids of facts that support `path`: the path itself, an ancestor, or a descendant. */
  ids(path: string): string[] {
    const out = new Set<string>();
    for (const f of this.facts) {
      if (f.path === path || path.startsWith(`${f.path}/`) || f.path.startsWith(`${path}/`)) out.add(f.id);
    }
    return [...out];
  }

  /** Facts stored exactly at `path` or below it, in path order (for values not kept in the profile). */
  under(path: string): FactRef[] {
    return this.facts.filter((f) => f.path === path || f.path.startsWith(`${path}/`)).sort((a, b) => a.path.localeCompare(b.path, "en", { numeric: true }));
  }

  /** The string value of a fact at exactly `path` (value, else the claim without its label). */
  factValue(path: string): Backed<string> | null {
    const f = this.byPath.get(path)?.[0];
    if (!f) return null;
    const v = typeof f.value === "string" ? f.value : typeof f.value === "number" ? String(f.value) : stripLabel(f.claim);
    return v ? { value: v, ids: [f.id] } : null;
  }

  private backed<T>(path: string, value: T | null | undefined): Backed<T> | null {
    if (value === null || value === undefined || value === "") return null;
    const ids = this.ids(path);
    return ids.length ? { value, ids } : null;
  }

  name(): Backed<string> | null {
    return this.backed("/identity/name", this.profile.identity.name);
  }
  firstName(): string | null {
    const n = this.profile.identity.name;
    if (!n) return null;
    return /[一-鿿]/.test(n) ? n : n.split(/\s+/)[0];
  }
  email(): Backed<string> | null {
    return this.backed("/identity/email", this.profile.identity.email);
  }
  phone(): Backed<string> | null {
    return this.backed("/identity/phone", this.profile.identity.phone);
  }
  location(): Backed<string> | null {
    return this.backed("/identity/location", this.profile.identity.location);
  }
  headline(): Backed<string> | null {
    return this.backed("/identity/headline", this.profile.identity.headline);
  }
  summary(): Backed<string> | null {
    return this.backed("/summary", this.profile.summary);
  }
  links(): Array<Backed<Profile["identity"]["links"][number]>> {
    return this.profile.identity.links.map((l, i) => this.backed(`/identity/links/${i}`, l)).filter((x): x is Backed<Profile["identity"]["links"][number]> => x !== null);
  }
  languages(): Array<Backed<Profile["identity"]["languages"][number]>> {
    return this.profile.identity.languages.map((l, i) => this.backed(`/identity/languages/${i}`, l)).filter((x): x is Backed<Profile["identity"]["languages"][number]> => x !== null);
  }
  workAuthorization(): Array<Backed<Profile["identity"]["workAuthorization"][number]>> {
    return this.profile.identity.workAuthorization
      .map((w, i) => this.backed(`/identity/workAuthorization/${i}`, w))
      .filter((x): x is Backed<Profile["identity"]["workAuthorization"][number]> => x !== null);
  }

  experiences(): Array<Backed<Exp>> {
    return this.profile.experience.map((e) => this.backed(`/experience/${e.id}`, e)).filter((x): x is Backed<Exp> => x !== null);
  }
  /** Current role first, then most recent; internships and volunteering after paid roles. */
  rankedExperiences(): Array<Backed<Exp>> {
    const weight = (e: Exp) => (e.employmentType === "internship" || e.employmentType === "volunteer" ? 1 : 0);
    return [...this.experiences()].sort((a, b) => weight(a.value) - weight(b.value) || Number(b.value.current) - Number(a.value.current) || (b.value.startDate ?? "").localeCompare(a.value.startDate ?? ""));
  }
  education(): Array<Backed<Edu>> {
    return this.profile.education.map((e) => this.backed(`/education/${e.id}`, e)).filter((x): x is Backed<Edu> => x !== null);
  }
  projects(): Array<Backed<Proj>> {
    return this.profile.projects.map((p) => this.backed(`/projects/${p.id}`, p)).filter((x): x is Backed<Proj> => x !== null);
  }
  skills(): Array<Backed<string>> {
    return this.profile.skills.map((s, i) => this.backed(`/skills/${i}`, s.name)).filter((x): x is Backed<string> => x !== null);
  }
  achievements(): Array<Backed<Ach>> {
    return this.profile.achievements.map((a) => this.backed(`/achievements/${a.id}`, a)).filter((x): x is Backed<Ach> => x !== null);
  }
  publications(): Array<Backed<Pub>> {
    return this.profile.publications.map((p) => this.backed(`/publications/${p.id}`, p)).filter((x): x is Backed<Pub> => x !== null);
  }
  certifications(): Array<Backed<Cert>> {
    return this.profile.certifications.map((c) => this.backed(`/certifications/${c.id}`, c)).filter((x): x is Backed<Cert> => x !== null);
  }
  researchFields(): Array<Backed<string>> {
    return (this.profile.packs.researcher?.fields ?? []).map((f, i) => this.backed(`/packs/researcher/fields/${i}`, f)).filter((x): x is Backed<string> => x !== null);
  }
  grants(): Array<Backed<NonNullable<Profile["packs"]["researcher"]>["grants"][number]>> {
    return (this.profile.packs.researcher?.grants ?? []).map((g, i) => this.backed(`/packs/researcher/grants/${i}`, g)).filter((x): x is Backed<NonNullable<Profile["packs"]["researcher"]>["grants"][number]> => x !== null);
  }
  targetRoles(): Array<Backed<string>> {
    return (this.profile.packs.jobSeeker?.targetOccupations ?? []).map((t, i) => this.backed(`/packs/jobSeeker/targetOccupations/${i}`, t)).filter((x): x is Backed<string> => x !== null);
  }
  availableFrom(): Backed<string> | null {
    return this.backed("/packs/jobSeeker/availableFrom", this.profile.packs.jobSeeker?.availableFrom ?? null) ?? this.backed("/packs/student/availableFrom", this.profile.packs.student?.availableFrom ?? null);
  }
  brands(): Array<Backed<string>> {
    return (this.profile.packs.creator?.brandsWorkedWith ?? []).map((b, i) => this.backed(`/packs/creator/brandsWorkedWith/${i}`, b)).filter((x): x is Backed<string> => x !== null);
  }
  audience(): Array<Backed<NonNullable<Profile["packs"]["creator"]>["audienceMetrics"][number]>> {
    return (this.profile.packs.creator?.audienceMetrics ?? [])
      .map((a, i) => this.backed(`/packs/creator/audienceMetrics/${i}`, a))
      .filter((x): x is Backed<NonNullable<Profile["packs"]["creator"]>["audienceMetrics"][number]> => x !== null);
  }

  /** The first venture with facts behind it. */
  venture(): VentureView | null {
    for (const v of this.profile.packs.founder?.ventures ?? []) {
      const base = `/packs/founder/ventures/${v.id}`;
      const ids = this.ids(base);
      if (ids.length) return new VentureView(this, v, base);
    }
    return null;
  }

  /** Years of professional experience over the backed roles (internships/volunteering excluded). */
  years(now?: Date): Backed<number> | null {
    const roles = this.experiences().filter((e) => e.value.employmentType !== "internship" && e.value.employmentType !== "volunteer" && e.value.startDate);
    if (!roles.length) return null;
    const y = totalYears(
      roles.map((r) => ({ start: r.value.startDate, end: r.value.endDate, current: r.value.current })),
      now,
    );
    return y >= 1 ? { value: Math.floor(y), ids: roles.flatMap((r) => r.ids) } : null;
  }
}

export class VentureView {
  constructor(
    private readonly view: FactView,
    readonly venture: Ven,
    readonly base: string,
  ) {}

  get company(): Backed<string> {
    const exact = this.companyIds();
    return { value: this.venture.company, ids: exact.length ? exact : this.view.ids(this.base) };
  }

  /** A venture field: from the profile when it keeps it, else from the fact's value (problem, market, useOfFunds…). */
  field(name: string): Backed<string> | null {
    const path = `${this.base}/${name}`;
    const own = this.view.under(path).map((f) => f.id);
    const fromProfile = (this.venture as unknown as Record<string, unknown>)[name];
    if ((typeof fromProfile === "string" && fromProfile) || typeof fromProfile === "number") {
      // The company fact's value carries the one-liner, so it supports it too.
      const ids = own.length ? own : name === "oneLiner" ? this.companyIds() : [];
      if (ids.length) return { value: String(fromProfile), ids };
    }
    return this.view.factValue(path);
  }

  companyIds(): string[] {
    return this.view.under(this.base).filter((f) => f.path === this.base).map((f) => f.id);
  }

  traction(): Array<Backed<string>> {
    return this.view
      .under(`${this.base}/traction/items`)
      .map((f) => ({ value: typeof f.value === "string" ? f.value : f.claim.replace(/^[^:：]{1,24}[:：]\s*/, ""), ids: [f.id] }))
      .filter((t) => t.value);
  }

  team(): Array<Backed<{ name: string; role: string | null; background: string | null }>> {
    return this.view.under(`${this.base}/team`).map((f) => {
      const v = (f.value && typeof f.value === "object" ? f.value : {}) as { name?: string; role?: string | null; background?: string | null };
      return { value: { name: v.name ?? f.claim.replace(/^[^:：]{1,24}[:：]\s*/, "").split(/[,，(]/)[0].trim(), role: v.role ?? null, background: v.background ?? null }, ids: [f.id] };
    });
  }

  raising(): Backed<string> | null {
    const f = this.view.under(`${this.base}/currentRound`)[0];
    if (!f) return null;
    const text = f.claim.replace(/^[^:：]{1,24}[:：]\s*/, "");
    return { value: text, ids: [f.id] };
  }
}
