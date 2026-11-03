import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import common from "../messages/en/common.json";
import onboarding from "../messages/en/onboarding.json";
import { applicationCap, buildMilestones, cappedMilestone } from "@/lib/core/playbooks";
import { emptyProfile, type IdentityCode, type Profile } from "@/lib/core/types";
import { localRecommendDirections, profileSummary } from "@/lib/llm/local/directions";
import { localExtractProfile } from "@/lib/llm/local/extract";
import { inferIdentities, statedStudy } from "@/lib/llm/local/identity";
import { parseResume } from "@/lib/llm/local/resume";
import { goalOccupation, isSideRole, roleNoun } from "@/lib/llm/local/roles";
import type { DirectionCandidate } from "@/lib/llm/types";
import { studyCodeFromEducation } from "@/lib/profile/presets";
import { OTHER_GOAL, QUICK_GOALS } from "@/lib/profile/quick-goals";
import { successOptions } from "@/lib/profile/success-params";

/*
 * Regressions from the new-visitor walk of 2026-11-02 with the local engine (every visitor gets it
 * while the Claude balance is out). The résumé is fictional: an Indian engineering undergraduate
 * whose PDF text wraps the education line and drops the bullet glyphs.
 */

const fx = (f: string) => readFileSync(path.join(import.meta.dirname, "fixtures", f), "utf8");
const NOW = "2026-11-02";

function extract(file: string) {
  return localExtractProfile({ documents: [{ id: "doc_cv", kind: "resume", filename: file, text: fx(file) }], locale: "en", now: NOW });
}

const countOf = (out: ReturnType<typeof extract>, section: string) => out.facts.filter((f) => new RegExp(`^/${section}/[^/]+$`).test(f.path)).length;

describe("the student résumé reads as a student's", () => {
  for (const file of ["resume-student-in-pdf.txt", "resume-student-in.txt"]) {
    describe(file, () => {
      const out = extract(file);
      const p = out.profile;

      it("finds one school, two roles and two projects (the upload row's counts)", () => {
        expect(countOf(out, "education")).toBe(1);
        expect(countOf(out, "experience")).toBe(2);
        expect(countOf(out, "projects")).toBe(2);
        expect(p.projects.map((x) => x.name)).toEqual(["KrishiAlert", "BusBuddy"]);
      });

      it("reads the B.E. as a bachelor's in progress at the college and its university", () => {
        expect(p.education[0]).toMatchObject({ institution: "College of Engineering Guindy, Anna University", degree: "B.E.", level: "bachelor", field: "Computer Science and Engineering", startDate: "2023", endDate: "2027" });
      });

      it("pre-selects the student, not 'working' or 'between jobs' (the internship and the TA job ended)", () => {
        expect(p.roles.map((r) => r.code)).toEqual(["S2"]);
        expect(p.roles[0]).toMatchObject({ inferred: true, stage: "year_4_plus" });
        expect(out.identities.some((g) => g.code.startsWith("E") || g.code === "T1")).toBe(false);
      });
    });
  }

  it("keeps each project's description with its project when the PDF dropped the bullets", () => {
    const parsed = parseResume(fx("resume-student-in-pdf.txt"));
    const [krishi, bus] = parsed.projects.map((x) => x.entry);
    expect(krishi!.summary).toBe("Python + FastAPI service that classifies leaf photos with a fine-tuned MobileNet (91% accuracy on PlantVillage) and replies in Tamil.");
    expect(krishi!.highlights).toEqual(["Built in 36 hours at Smart India Hackathon 2025 internal round with a team of four; I led the backend."]);
    expect(bus).toMatchObject({ name: "BusBuddy", start: "2024" });
  });

  it("keeps a long degree or title line in the header (only prose descriptions become the body)", () => {
    const edu = parseResume(["EDUCATION", "University of Texas at Austin  2018 – 2022", "Bachelor of Science in Computer Science with a minor in Applied Mathematics and Statistics"].join("\n")).education[0]!.entry;
    expect(edu).toMatchObject({ institution: "University of Texas at Austin", level: "bachelor" });
    const exp = parseResume(["EXPERIENCE", "Stripe  2019 – 2022", "Senior Software Engineer, Payments team responsible for the ledger and billing services", "Built the ledger service that settles payouts for every connected account in 40 countries"].join("\n")).experience[0]!.entry;
    expect(exp).toMatchObject({ organization: "Stripe" });
    expect(exp.title).toMatch(/^Senior Software Engineer/);
    expect(exp.highlights).toEqual(["Built the ledger service that settles payouts for every connected account in 40 countries"]);
  });

  it("files the coursework under the school as courses, the line the PDF wrapped included", () => {
    const edu = extract("resume-student-in-pdf.txt").profile.education[0]!;
    expect(edu.courses).toEqual(["Data Structures", "Operating Systems", "Machine Learning", "Database Systems"]);
    expect(edu.honors).toEqual([]);
  });

  it("joins a date range the PDF split over two lines and a university name cut before its last word", () => {
    const parsed = parseResume(["EDUCATION", "B.Tech Information Technology, Sri Venkateswara College of Engineering, Anna", "University", "2022 –", "2026"].join("\n"));
    expect(parsed.education).toHaveLength(1);
    expect(parsed.education[0]!.entry).toMatchObject({ institution: "Sri Venkateswara College of Engineering, Anna University", level: "bachelor", start: "2022", end: "2026" });
  });
});

describe("a student says so in their own words", () => {
  const profile = (summary: string, headline: string | null = null) => ({ summary, identity: { ...emptyProfile().identity, headline } });

  it("reads the level the person names", () => {
    expect(statedStudy(profile("Third-year computer science student who builds full-stack web apps."))).toMatchObject({ level: "bachelor" });
    expect(statedStudy(profile("Master's student in statistics at Fudan."))).toMatchObject({ level: "master" });
    expect(statedStudy(profile("", "PhD candidate in neuroscience"))).toMatchObject({ level: "doctorate" });
    expect(statedStudy(profile("Currently pursuing a B.Tech in mechanical engineering."))).toMatchObject({ level: "bachelor" });
  });

  it("ignores other people's studies and past ones", () => {
    expect(statedStudy(profile("Data scientist mentoring student founders on weekends."))).toBeNull();
    expect(statedStudy(profile("Former student athlete, now a product manager."))).toBeNull();
    expect(statedStudy(profile("Product designer with 7 years of experience."))).toBeNull();
    expect(statedStudy(profile("", "Student Success Manager at Coursera"))).toBeNull();
    expect(statedStudy(profile("", "Data Science Student | Python | SQL"))).toMatchObject({ level: "bachelor" });
  });

  it("is a student even when no degree in progress was read, and an ended internship doesn't make them working", () => {
    const p: Profile = {
      ...emptyProfile(),
      summary: "Third-year computer science student looking for a summer internship.",
      experience: [
        { id: "x1", organization: "Zoho Corporation", title: "Software Engineering Intern", occupation: null, employmentType: "internship", industry: null, location: null, startDate: "2025-05", endDate: "2025-07", current: false, summary: null, highlights: [], skills: [] },
        { id: "x2", organization: "CEG", title: "Teaching Assistant", occupation: "teaching-assistant", employmentType: null, industry: null, location: null, startDate: "2025-01", endDate: "2025-04", current: false, summary: null, highlights: [], skills: [] },
      ],
    };
    const codes = inferIdentities(p, [p.summary!], { now: new Date(NOW) }).map((g) => g.code);
    expect(codes[0]).toBe("S2");
    expect(codes).not.toContain("E1");
    expect(codes).not.toContain("T1");
  });

  it("still sees someone between jobs when their last real job ended", () => {
    const p: Profile = {
      ...emptyProfile(),
      experience: [{ id: "x1", organization: "Northwind Lending", title: "Data Analyst", occupation: null, employmentType: "full_time", industry: null, location: null, startDate: "2021-03", endDate: "2025-12", current: false, summary: null, highlights: [], skills: [] }],
    };
    const codes = inferIdentities(p, [], { now: new Date(NOW) }).map((g) => g.code);
    expect(codes).toContain("T1");
    expect(codes).toContain("E2");
  });

  it("counts an assistantship as a side role only while the person studies", () => {
    const ta = { title: "Research Assistant", employmentType: null };
    expect(isSideRole(ta, { student: true })).toBe(true);
    expect(isSideRole(ta)).toBe(false);
    expect(isSideRole({ title: "Software Engineering Intern", employmentType: null })).toBe(true);
    expect(isSideRole({ title: "Internal Auditor", employmentType: null })).toBe(false);
  });
});

/* ---------------------------------------------------------------- onboarding presets */

let query = "";
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(query) }));
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }) }));
vi.mock("@/components/Consent", () => ({ track: () => {} }));
vi.mock("next/link", () => ({ default: () => null }));
const { OnboardingFlow } = await import("@/components/onboarding/OnboardingFlow");

function render(q: string, profile: Profile): string {
  query = q;
  return renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale: "en", timeZone: "UTC", messages: { common, onboarding } } as unknown as ComponentProps<typeof NextIntlClientProvider>,
      createElement(OnboardingFlow, { mode: "draft", signedIn: false, locale: "en", claim: false, status: { phase: "idle", documents: [], profile: null } as never, profile, confirmedPaths: [] }),
    ),
  );
}
const pressed = (html: string) => [...html.matchAll(/aria-pressed="true"[^>]*>(.*?)<\/button>/g)].map((m) => m[1]!.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim());

const BE_IN_PROGRESS: Profile["education"][number] = { id: "e1", institution: "College of Engineering Guindy, Anna University", degree: "B.E.", level: null, field: "Computer Science and Engineering", location: null, startDate: "2023", endDate: "2099", current: false, gpa: null, honors: [], courses: [], description: null };

describe("onboarding presets from a degree in progress", () => {
  it("pre-selects 'I'm a student' and 'Undergraduate' from the résumé", () => {
    const p: Profile = { ...emptyProfile(), education: [BE_IN_PROGRESS] };
    expect(pressed(render("q=situation", p))).toEqual(["I'm a student From your résumé"]);
    expect(pressed(render("q=detail&g=S", p))).toEqual(["Undergraduate From your résumé"]);
  });

  it("pre-selects Undergraduate when the files guessed another situation and the person tapped 'student'", () => {
    const p: Profile = { ...emptyProfile(), education: [BE_IN_PROGRESS], roles: [{ code: "E1", stage: null, since: null, inferred: true }] };
    expect(pressed(render("q=detail&g=S", p))).toEqual(["Undergraduate From your résumé"]);
  });

  it("maps the degree in progress to the study detail; a finished one to nothing", () => {
    const now = new Date(NOW);
    const edu = (degree: string, endDate: string, level: Profile["education"][number]["level"] = null) => ({ education: [{ ...BE_IN_PROGRESS, degree, endDate, level }] });
    for (const d of ["B.E.", "B.Tech", "BSc", "B.A.", "Bachelor of Science"]) expect(studyCodeFromEducation(edu(d, "2027"), now)).toBe("S2");
    expect(studyCodeFromEducation(edu("MSc", "2027-06"), now)).toBe("S3");
    expect(studyCodeFromEducation(edu("PhD", "2028"), now)).toBe("S4");
    expect(studyCodeFromEducation(edu("B.E.", "2026-06"), now)).toBeNull();
    expect(studyCodeFromEducation(edu("Diploma", "2027", "associate"), now)).toBe("S7");
  });
});

/* ---------------------------------------------------------------- the goal's role */

describe("an internship goal is named after the person's main role in their field", () => {
  const student = extract("resume-student-in-pdf.txt").profile;

  it("uses the Zoho internship (most recent, in the field), never the teaching assistantship", () => {
    const answered: Profile = { ...student, functions: ["engineering"] };
    expect(goalOccupation(answered)).toBe("software-engineer");
    expect(successOptions("G1.2", answered, 6, "en")[0]!.text).toBe("Land a Software Engineer internship within 6 months");
    expect(successOptions("G1.2", { ...student, functions: [] }, 6, "en")[0]!.text).toBe("Land a Software Engineer internship within 6 months");
  });

  it("names a side role only when it is the person's field, and nothing rather than a wrong role", () => {
    const ta = { ...student, experience: student.experience.filter((e) => /Teaching/.test(e.title)), occupations: ["teaching-assistant"] };
    expect(goalOccupation({ ...ta, functions: ["teaching"] })).toBe("teaching-assistant");
    expect(goalOccupation({ ...ta, functions: ["engineering"] })).toBeNull();
    expect(goalOccupation({ ...ta, functions: [] })).toBeNull();
    expect(successOptions("G1.2", { ...ta, functions: ["engineering"] }, 6, "en")[0]!.text).toBe("Land an internship within 6 months");
  });

  it("reads intern titles as the role they name", () => {
    expect(roleNoun("Software Engineering Intern")).toBe("Software Engineer");
    expect(roleNoun("Summer Data Science Intern")).toBe("Data Scientist");
    expect(roleNoun("Product Management Intern")).toBe("Product Manager");
  });
});

/* ---------------------------------------------------------------- milestone sizes */

describe("application milestones ask for a number a person can send", () => {
  const apps = (sub: Parameters<typeof buildMilestones>[1]["sub"], horizonMonths = 6, intensity: "light" | "steady" | "intense" = "steady") =>
    buildMilestones("G1", { intensity, horizonMonths, sub }).find((m) => m.metric === "applications")!;

  it("caps internships at 30 and full-time jobs at 40 over six steady months, scaled by horizon and intensity", () => {
    expect(apps("G1.2")).toMatchObject({ target: 30, title: { en: "Apply to 30 internships that fit you", zh: "投递 30 个适合你的实习" } });
    expect(apps("G1.1")).toMatchObject({ target: 40, title: { en: "Apply to 40 high-match roles" } });
    expect(apps("G1.1", 3).target).toBe(20);
    expect(apps("G1.2", 3).target).toBe(15);
    expect(apps("G1.1", 12).target).toBe(80);
    expect(apps("G1.1", 6, "light").target).toBe(20);
    expect(apps("G1.2", 6, "intense").target).toBe(45);
    expect(apps("G1.3").title.en).toBe("Apply to 20 graduate programmes that fit you");
    // Returnships stay a fixed 12 whatever the horizon.
    expect(apps("G1.9", 12).target).toBe(12);
    expect(apps(null).target).toBe(40);
    expect(applicationCap("G3", "G3.2", "steady", 6)).toBeNull();
  });

  it("shows a milestone set before the caps at the capped size, and leaves the person's own wording alone", () => {
    const goal = { family: "G1" as const, sub: "G1.2", horizonMonths: 6, intensity: "steady" as const };
    expect(cappedMilestone({ title: "Apply to 130 high-match roles", target: 130, position: 1, metric: "applications" }, goal)).toMatchObject({ title: "Apply to 30 internships that fit you", target: 30 });
    expect(cappedMilestone({ title: "投递 130 个高匹配岗位", target: 130, position: 1, metric: "applications" }, goal)).toMatchObject({ title: "投递 30 个适合你的实习", target: 30 });
    const mine = { title: "Send 130 applications, no matter what", target: 130, position: 1, metric: "applications" };
    expect(cappedMilestone(mine, goal)).toBe(mine);
    const interviews = { title: "Reach 4 interviews", target: 4, position: 2, metric: "interviews" };
    expect(cappedMilestone(interviews, goal)).toBe(interviews);
  });
});

/* ---------------------------------------------------------------- returners and the plan line */

const OPEN: Record<string, number> = { job: 4000, internship: 900, returnship: 78, graduate: 16, scholarship: 46, fellowship: 52, accelerator: 65, investors: 11, pitch: 32, phd: 18, grant: 29, cfp: 44, art: 40, hackathon: 20, other: 34000 };

function candidates(codes: IdentityCode[], open: Record<string, number> = OPEN): DirectionCandidate[] {
  // Audience as the catalog states it (returnships are aimed at T6).
  const forThem: Record<string, (c: IdentityCode) => boolean> = { job: (c) => /^(E|T|P|S5)/.test(c), returnship: (c) => c === "T6", internship: (c) => c.startsWith("S"), other: () => true };
  return [...QUICK_GOALS, OTHER_GOAL].map((g) => ({
    id: g.id,
    family: g.family,
    sub: g.sub,
    label: g.id,
    opportunityTypes: [],
    open: open[g.id] ?? 0,
    forThem: codes.some((c) => forThem[g.id]?.(c) ?? false),
    field: g.id === "job" ? "Data" : null,
    paths: [...g.paths],
  }));
}

function person(code: IdentityCode, extra: Partial<Profile> = {}): Profile {
  return { ...emptyProfile(), roles: [{ code, stage: null, since: null, inferred: false }], functions: ["data"], identity: { ...emptyProfile().identity, city: "London" }, ...extra };
}
const plan = (p: Profile, open?: Record<string, number>) => localRecommendDirections({ profile: p, candidates: candidates(p.roles.map((r) => r.code), open), language: "en" });

describe("a returner's plan leads with returnships", () => {
  it("puts someone back from caregiving on returnships first, a full-time job second", () => {
    const out = plan(person("T6"));
    expect(out.path).toBe("work");
    expect(out.directions.map((d) => d.id)).toEqual(["returnship", "job"]);
    expect(out.headline).toBe("A returnship within 6 months");
    expect(out.directions[0]!.reason).toContain("78");
  });

  it("does the same for an older worker returning and for a stated career break without a current role", () => {
    expect(plan(person("T7")).directions[0]!.id).toBe("returnship");
    const breakStated = person("T1", { summary: "Returning to work after a five-year career break raising my children." });
    expect(plan(breakStated).directions.map((d) => d.id).slice(0, 2)).toEqual(["returnship", "job"]);
  });

  it("leaves returnships out for someone simply between jobs, and when none are open", () => {
    expect(plan(person("T1")).directions.map((d) => d.id)).not.toContain("returnship");
    expect(plan(person("T6"), { ...OPEN, returnship: 0 }).directions[0]!.id).toBe("job");
  });
});

describe("the plan line reads as a sentence for every kind of person", () => {
  const line = (code: IdentityCode, lang: "en" | "zh" = "en") => profileSummary(person(code), lang);

  it("uses a noun for most people and a verb phrase for people in transition", () => {
    expect(line("S2")).toBe("You're an undergraduate in Data, based in London.");
    expect(line("E1")).toBe("You're an early-career professional in Data, based in London.");
    expect(line("T6")).toBe("You're returning to work after caregiving, focused on Data, based in London.");
    expect(line("F2")).toBe("You're an early-stage founder in Data, based in London.");
    expect(line("T1")).toBe("You're between jobs, focused on Data, based in London.");
    expect(line("S1")).toBe("You're a high school student interested in Data, based in London.");
  });

  it("never puts an article before an identity label", () => {
    const codes: IdentityCode[] = ["S1", "S2", "S3", "S4", "S5", "S6", "S7", "E1", "E2", "E3", "E4", "E5", "E6", "E7", "E8", "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "R1", "R2", "R3", "R4", "R5", "R6", "C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "P1", "P2", "P3", "P4", "P5", "P6", "P7", "T1", "T2", "T3", "T4", "T5", "T6", "T7"];
    for (const c of codes) {
      const s = line(c);
      expect(s).toMatch(/^You're /);
      expect(s).not.toMatch(/You're an? (returning|between|moving|early career|mid-level \(|idea stage|public sector\b|skilled trades\b|service industry\b)/i);
      expect(s).not.toMatch(/\(|\)/);
    }
  });

  it("reads in Chinese too", () => {
    expect(line("T6", "zh")).toBe("你正在育儿后重返职场，方向是数据，在London。");
    expect(line("S2", "zh")).toBe("你是本科生，方向是数据，在London。");
  });
});
