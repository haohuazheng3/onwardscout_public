import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { atsApiUrl, atsFromUrl, atsHostedFormUrl, coordsOf, parseAshbyPosting, parseGreenhousePosting, parseLeverCards, parseLeverPosting } from "@/lib/channels/ats";
import { materialsFor } from "@/lib/channels/detect";
import { buildHandoff } from "@/lib/channels/handoff";
import { choiceValue, questionsOf } from "@/lib/channels/html-form";

/*
 * Fixtures are real public postings fetched once from the public posting APIs (no key) and
 * trimmed (descriptions removed): Figma and Stripe on Greenhouse, and Palantir's Lever apply
 * page reduced to its <form>. Tests never touch the network.
 */
const fx = (f: string) => readFileSync(path.join(import.meta.dirname, "fixtures", "channels", f), "utf8");
const figma = JSON.parse(fx("greenhouse-figma-posting.json")) as unknown;
const stripe = JSON.parse(fx("greenhouse-stripe-posting.json")) as unknown;

describe("ATS coordinates", () => {
  it("recognises hosted posting URLs of the three providers", () => {
    expect(atsFromUrl("https://boards.greenhouse.io/figma/jobs/5426468004?gh_jid=5426468004")).toEqual({ provider: "greenhouse", board: "figma", postingId: "5426468004" });
    expect(atsFromUrl("https://job-boards.greenhouse.io/aclu/jobs/8782750002")).toEqual({ provider: "greenhouse", board: "aclu", postingId: "8782750002" });
    expect(atsFromUrl("https://boards.greenhouse.io/embed/job_app?for=discord&token=8806482002")).toEqual({ provider: "greenhouse", board: "discord", postingId: "8806482002" });
    expect(atsFromUrl("https://jobs.lever.co/palantir/6ed76ce8-4156-4b60-b120-403538bd66cd/apply")).toEqual({ provider: "lever", board: "palantir", postingId: "6ed76ce8-4156-4b60-b120-403538bd66cd" });
    expect(atsFromUrl("https://jobs.ashbyhq.com/1password/6f78b170-9600-4b2d-9682-feead160100d/application")).toEqual({
      provider: "ashby",
      board: "1password",
      postingId: "6f78b170-9600-4b2d-9682-feead160100d",
    });
  });

  it("ignores everything else", () => {
    expect(atsFromUrl("https://stripe.com/jobs/search?gh_jid=8172487")).toBeNull(); // no board in the URL
    expect(atsFromUrl("https://www.linkedin.com/jobs/view/123")).toBeNull();
    expect(atsFromUrl("https://boards.greenhouse.io/figma")).toBeNull();
    expect(atsFromUrl("not a url")).toBeNull();
    expect(atsFromUrl(null)).toBeNull();
  });

  it("prefers apply.ats, then the apply URL, then the page URL", () => {
    expect(coordsOf({ apply: { ats: { provider: "lever", board: "x", postingId: "y" }, url: null }, url: null })).toEqual({ provider: "lever", board: "x", postingId: "y" });
    expect(coordsOf({ apply: { ats: null, url: null }, url: "https://job-boards.greenhouse.io/figma/jobs/1" })?.board).toBe("figma");
  });

  it("builds the public API and hosted form URLs", () => {
    const gh = { provider: "greenhouse", board: "figma", postingId: "5426468004" } as const;
    expect(atsApiUrl(gh)).toBe("https://boards-api.greenhouse.io/v1/boards/figma/jobs/5426468004?questions=true");
    expect(atsHostedFormUrl(gh)).toBe("https://job-boards.greenhouse.io/figma/jobs/5426468004");
    expect(atsApiUrl({ provider: "lever", board: "palantir", postingId: "abc" })).toBe("https://api.lever.co/v0/postings/palantir/abc");
    expect(atsHostedFormUrl({ provider: "lever", board: "palantir", postingId: "abc" })).toBe("https://jobs.lever.co/palantir/abc/apply");
    expect(atsApiUrl({ provider: "ashby", board: "1password", postingId: "abc" })).toContain("api.ashbyhq.com/posting-api/job-board/1password");
    expect(atsHostedFormUrl({ provider: "ashby", board: "1password", postingId: "abc" })).toBe("https://jobs.ashbyhq.com/1password/abc/application");
  });
});

describe("Greenhouse posting → requirements (Figma fixture)", () => {
  const p = parseGreenhousePosting(figma);
  const byName = (n: string) => p.fields.find((f) => f.name === n);

  it("reads the posting meta", () => {
    expect(p.title).toBeTruthy();
    expect(p.company).toBe("Figma");
    expect(p.captchaLikely).toBe(true);
    expect(p.notes[0]).toMatch(/CAPTCHA/);
  });

  it("keeps the form's order and the standard fields with the right types", () => {
    expect(p.fields.slice(0, 5).map((f) => f.name)).toEqual(["first_name", "last_name", "email", "phone", "resume"]);
    expect(byName("email")).toMatchObject({ type: "email", required: true, profilePath: "/identity/email" });
    expect(byName("phone")).toMatchObject({ type: "tel", required: true });
    expect(byName("resume")).toMatchObject({ type: "file", required: true, key: "resume" });
    expect(byName("resume")?.help).toMatch(/paste the text/);
    expect(byName("first_name")).toMatchObject({ profilePath: "/identity/name", key: "first_name" });
  });

  it("reads custom questions, their options and option ids", () => {
    const why = p.fields.find((f) => /Why do you want to join Figma/.test(f.label));
    expect(why).toMatchObject({ type: "textarea", required: true, question: true });
    const auth = p.fields.find((f) => /authorized to work/.test(f.label));
    expect(auth?.type).toBe("select");
    expect(auth?.options).toEqual(["Yes", "No"]);
    expect(auth?.choices?.[0]).toEqual({ value: expect.stringMatching(/^\d+$/), label: "Yes" });
    expect(auth?.question).toBe(true);
    const linkedin = p.fields.find((f) => f.label === "LinkedIn Profile");
    expect(linkedin).toMatchObject({ type: "url", key: "linkedin_url", required: false });
  });

  it("marks self-identification questions as the person's alone", () => {
    const pronouns = p.fields.find((f) => f.label === "Pronouns");
    expect(pronouns?.userOnly).toBe(true);
    expect(pronouns?.question).toBeUndefined();
    const eeo = p.fields.filter((f) => f.section === "Voluntary self-identification");
    expect(eeo.length).toBeGreaterThanOrEqual(3);
    for (const f of eeo) expect(f).toMatchObject({ userOnly: true, required: false });
  });

  it("adds the location question and skips hidden coordinates", () => {
    expect(byName("location")).toMatchObject({ type: "text", required: true });
    expect(byName("latitude")).toBeUndefined();
    expect(byName("longitude")).toBeUndefined();
  });

  it("lists long questions to compose and the materials", () => {
    const qs = questionsOf(p.fields);
    expect(qs.map((q) => q.prompt)).toContain("Why do you want to join Figma?");
    expect(qs.every((q) => p.fields.find((f) => f.name === q.id))).toBe(true);
    expect(materialsFor(p.fields)).toContain("resume_variant");
  });

  it("maps a prepared Yes/No answer onto Greenhouse's option id", () => {
    const auth = p.fields.find((f) => /authorized to work/.test(f.label))!;
    expect(choiceValue(auth.choices!, "Yes")).toBe(auth.choices![0].value);
    expect(choiceValue(auth.choices!, "no")).toBe(auth.choices![1].value);
  });
});

describe("Greenhouse posting with multi-select and long option lists (Stripe fixture)", () => {
  const p = parseGreenhousePosting(stripe);
  it("reads multi-select questions with their [] field names", () => {
    const multi = p.fields.find((f) => f.type === "multiselect");
    expect(multi?.name).toMatch(/\[\]$/);
    expect((multi?.options ?? []).length).toBeGreaterThan(10);
    expect(multi?.required).toBe(true);
  });
  it("keeps cover letter optional and employer questions as custom questions", () => {
    expect(p.fields.find((f) => f.name === "cover_letter")).toMatchObject({ type: "file", required: false });
    const employer = p.fields.find((f) => /current or previous employer/.test(f.label));
    expect(employer).toMatchObject({ type: "text", required: true, question: true, key: "current_company" });
  });
});

describe("Lever posting + public apply page", () => {
  const posting = JSON.parse(fx("lever-posting.json")) as unknown;
  const html = fx("lever-apply.html");

  it("reads custom question cards from their templates", () => {
    const cards = parseLeverCards(html);
    expect(cards.length).toBeGreaterThanOrEqual(8);
    const auth = cards.find((c) => /legally authorized to work/.test(c.label));
    expect(auth).toMatchObject({ type: "select", required: true, options: ["Yes", "No"], section: "Work Authorization" });
    expect(auth?.name).toMatch(/^cards\[[0-9a-f-]+\]\[field0\]$/);
    const langs = cards.find((c) => /Language Skill/.test(c.label));
    expect(langs?.type).toBe("multiselect");
    const why = cards.find((c) => /Why do you want to work at Palantir/.test(c.label));
    expect(why).toMatchObject({ type: "textarea", question: true });
  });

  it("puts standard fields first, custom questions before Additional information, and sees the hCaptcha", () => {
    const p = parseLeverPosting(posting, html);
    const names = p.fields.map((f) => f.name);
    expect(names.slice(0, 3)).toEqual(["resume", "name", "email"]);
    expect(names).toContain("urls[LinkedIn]");
    expect(names).not.toContain("urls[Twitter]"); // not on this employer's form
    expect(names.indexOf("comments")).toBeGreaterThan(names.findIndex((n) => n.startsWith("cards[")));
    expect(p.captchaLikely).toBe(true);
    expect(p.title).toBe("Administrative Business Partner");
  });

  it("falls back to Lever's standard form when the apply page can't be read", () => {
    const p = parseLeverPosting(posting, null);
    expect(p.fields.map((f) => f.name)).toContain("urls[Twitter]");
    expect(p.notes.join(" ")).toMatch(/extra questions/);
  });
});

describe("Ashby", () => {
  it("lists the standard fields of the posting it finds, honestly noting extra questions", () => {
    const p = parseAshbyPosting({ jobs: [{ id: "abc", title: "Engineer", location: "Remote" }] }, "abc");
    expect(p?.fields.map((f) => f.label)).toEqual(["Name", "Email", "Phone", "Resume", "LinkedIn"]);
    expect(p?.notes.join(" ")).toMatch(/doesn't publish/);
    expect(parseAshbyPosting({ jobs: [] }, "abc")).toBeNull();
  });
});

describe("handoff ordered like the Greenhouse form", () => {
  it("lists answered fields in form order, files separately and EEO as the person's", () => {
    const p = parseGreenhousePosting(figma);
    const auth = p.fields.find((f) => /authorized to work/.test(f.label))!;
    const why = p.fields.find((f) => /Why do you want/.test(f.label))!;
    const h = buildHandoff(
      { name: "Product Designer", orgName: "Figma", url: "https://boards.greenhouse.io/figma/jobs/5426468004", apply: { channel: "CH1", url: null, email: null, platform: "greenhouse", fieldsSchema: [], requiresAccount: false, requiresPayment: false, captchaLikely: true, ats: null, instructions: null }, deadline: null, rolling: false },
      { ...p, channel: "CH1", requiresAccount: false, requiresPayment: false, submitUrl: "https://job-boards.greenhouse.io/figma/jobs/5426468004" },
      { first_name: "Mei", last_name: "Chen", email: "mei@example.com", phone: "+1 415 555 0134", [auth.name]: auth.choices![0].value, [why.name]: "I have shipped design systems used by…" },
      [{ field: "resume", filename: "Mei-Chen-resume.pdf", generatedDocumentId: "gen_1" }],
    );
    expect(h.url).toBe("https://job-boards.greenhouse.io/figma/jobs/5426468004");
    expect(h.fields.slice(0, 4).map((f) => f.label)).toEqual(["First Name", "Last Name", "Email", "Phone"]);
    expect(h.fields.find((f) => /authorized/.test(f.label))?.value).toBe("Yes");
    expect(h.fields.find((f) => /Why do you want/.test(f.label))?.long).toBe(true);
    expect(h.files).toEqual([{ name: "Mei-Chen-resume.pdf", generatedDocumentId: "gen_1" }]);
    const steps = h.steps.map((s) => s.text).join("\n");
    expect(steps).toMatch(/CAPTCHA/);
    expect(steps).toMatch(/Answer these yourself/);
    expect(steps).toMatch(/I submitted it/);
    expect(h.steps.map((s) => s.n)).toEqual(h.steps.map((_, i) => i + 1));
  });
});
