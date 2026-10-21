import { describe, expect, it } from "vitest";
import {
  clip,
  contentHash,
  deadlineFromDate,
  decodeEntities,
  describe as describeText,
  detectJobType,
  detectLanguage,
  htmlToParagraphs,
  industryCodes,
  isGeneralApplication,
  jobFunctions,
  jobQuality,
  jobSlug,
  jobTags,
  mapMaterials,
  moneyMentions,
  orgSlugOf,
  parseApplicationFee,
  parseEquityPercent,
  parseMinYears,
  parseMoney,
  slugify,
  stableStringify,
  statesStudentsOnly,
  summarize,
} from "@/lib/sources/normalize";

describe("HTML to text", () => {
  it("decodes named, decimal and hex entities", () => {
    expect(decodeEntities("Tom &amp; Jerry &#39;s &#x2014; caf&eacute;&nbsp;x &bogus;")).toBe("Tom & Jerry 's — café x &bogus;");
  });
  it("reads entity-escaped HTML (Greenhouse content) into paragraphs", () => {
    const html = "&lt;div&gt;&lt;h2&gt;The Role&lt;/h2&gt;&lt;p&gt;You will build things &amp;amp; ship.&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Write code&lt;/li&gt;&lt;li&gt;Review code&lt;/li&gt;&lt;/ul&gt;&lt;/div&gt;";
    expect(htmlToParagraphs(html)).toEqual(["The Role", "You will build things & ship.", "• Write code", "• Review code"]);
  });
  it("keeps a bullet with its text when list items wrap paragraphs (Lever)", () => {
    expect(htmlToParagraphs("<ul><li>\n<p><strong>Own:</strong> the roadmap</p>\n</li><li><p>Ship</p></li></ul>")).toEqual(["• Own: the roadmap", "• Ship"]);
  });
  it("drops scripts, styles and comments; turns <br> into line breaks within a paragraph", () => {
    expect(htmlToParagraphs("<style>p{}</style><!-- x --><p>One<br>two</p><script>alert(1)</script>")).toEqual(["One two"]);
  });
  it("returns nothing for empty input", () => {
    expect(htmlToParagraphs(null)).toEqual([]);
    expect(htmlToParagraphs("")).toEqual([]);
  });
});

describe("summaries and descriptions", () => {
  const paragraphs = [
    "Meet Acme",
    "Acme is a global leader in rockets, founded in 2010 and backed by great investors.",
    "The Role",
    "We're looking for a Senior Rocket Engineer to design and test engines for our next launch vehicle, working with a small team.",
    "What you'll do",
    "• Design engines",
    "• Test engines",
    "Acme is an equal opportunity employer and considers applicants without regard to protected status.",
  ];
  it("takes the paragraph after the role heading, not the company boilerplate", () => {
    expect(summarize(paragraphs, { title: "Senior Rocket Engineer", org: "Acme" })).toBe(paragraphs[3]);
  });
  it("summarises from the duties when the role section opens with bullets", () => {
    expect(summarize(["Responsibilities", "• Manage the full sales cycle", "• Close enterprise deals"], { title: "Account Executive" })).toBe("Manage the full sales cycle. Close enterprise deals.");
  });
  it("scores role paragraphs above company paragraphs when there is no heading", () => {
    const p = ["Acme is a global leader in rockets and was founded in 2010 by engineers.", "At Acme, we value curiosity and care deeply about each other and our customers.", "As a Rocket Engineer you will own the engine test campaign from design to flight."];
    expect(summarize(p, { title: "Rocket Engineer", org: "Acme" })).toBe(p[2]);
  });
  it("skips list lead-ins and shouted lines", () => {
    const p = ["The Role", "AS A SENIOR SOFTWARE ENGINEER FOR THE GROWTH TEAM, YOU WILL:", "As a senior engineer you will design the growth platform that serves every product team here."];
    expect(summarize(p, { title: "Senior Software Engineer" })).toBe(p[2]);
  });
  it("returns null rather than company boilerplate", () => {
    expect(summarize(["Acme is a global leader in rockets and was founded in 2010 by a group of engineers."], { title: "Engineer", org: "Acme" })).toBeNull();
  });
  it("clips at a sentence or word boundary", () => {
    const long = `${"Word ".repeat(100)}end.`;
    const c = clip(long, 50);
    expect(c.length).toBeLessThanOrEqual(50);
    expect(c.endsWith("…")).toBe(true);
    expect(clip("First sentence is here. Second sentence is much longer than the limit allows for.", 40)).toBe("First sentence is here.");
    expect(clip("short", 10)).toBe("short");
  });
  it("stores the description from the role section, without EEO boilerplate, within the cap", () => {
    const d = describeText(paragraphs, 1600) ?? "";
    expect(d.startsWith("The Role")).toBe(true);
    expect(d).not.toContain("equal opportunity");
    expect(describeText(paragraphs.concat(Array(50).fill("x".repeat(200))), 500)?.length).toBeLessThanOrEqual(500);
  });
});

describe("slugs and hashes", () => {
  it("slugifies with accents and ampersands", () => {
    expect(slugify("Café & Crème — Zürich 2026")).toBe("cafe-and-creme-zurich-2026");
    expect(slugify("北京")).toBe("");
    expect(slugify("a".repeat(100), 20).length).toBeLessThanOrEqual(20);
  });
  it("org slugs fall back to a hash for non-Latin names", () => {
    expect(orgSlugOf("Cockroach Labs")).toBe("cockroach-labs");
    expect(orgSlugOf("字节跳动")).toMatch(/^org-[0-9a-f]{10}$/);
    expect(orgSlugOf(null)).toBeNull();
  });
  it("job slugs are stable and unique per (provider, board, posting)", () => {
    const a = jobSlug("Software Engineer", "Acme", "greenhouse", "acme", "123");
    expect(a).toBe(jobSlug("Software Engineer", "Acme", "greenhouse", "acme", "123"));
    expect(a).not.toBe(jobSlug("Software Engineer", "Acme", "lever", "acme", "123"));
    expect(a).toMatch(/^software-engineer-acme-[0-9a-f]{8}$/);
  });
  it("hashes ignore key order", () => {
    expect(stableStringify({ b: 1, a: [1, { d: 2, c: 3 }] })).toBe('{"a":[1,{"c":3,"d":2}],"b":1}');
    expect(contentHash({ a: 1, b: 2 })).toBe(contentHash({ b: 2, a: 1 }));
    expect(contentHash({ a: 1 })).not.toBe(contentHash({ a: 2 }));
  });
});

describe("job type detection", () => {
  it("internships from the title or the employment type", () => {
    expect(detectJobType({ title: "Software Engineering Intern, Summer 2027" })).toBe("internship");
    expect(detectJobType({ title: "Creative Production", employmentType: "Intern" })).toBe("internship");
    expect(detectJobType({ title: "Werkstudent Marketing (m/w/d)" })).toBe("internship");
    expect(detectJobType({ title: "Co-op, Data Science" })).toBe("internship");
    expect(detectJobType({ title: "Summer Analyst - Investment Banking" })).toBe("internship");
  });
  it("does not mistake intern-like words", () => {
    expect(detectJobType({ title: "Internal Audit Manager" })).toBe("job");
    expect(detectJobType({ title: "International Sales Lead" })).toBe("job");
    expect(detectJobType({ title: "Account Executive, Early Stage Startups" })).toBe("job");
    expect(detectJobType({ title: "Internship Program Manager" })).toBe("job");
  });
  it("part-time and remote", () => {
    expect(detectJobType({ title: "Barista", employmentType: "PartTime" })).toBe("part_time");
    expect(detectJobType({ title: "Tutor (part-time)" })).toBe("part_time");
    expect(detectJobType({ title: "Backend Engineer", remote: "remote" })).toBe("remote_job");
    expect(detectJobType({ title: "Backend Engineer", remote: "hybrid" })).toBe("job");
    expect(detectJobType({ title: "Data Intern", remote: "remote" })).toBe("internship");
  });
  it("recognises talent pools", () => {
    expect(isGeneralApplication("Join our Talent Community!")).toBe(true);
    expect(isGeneralApplication("General Application")).toBe(true);
    expect(isGeneralApplication("Don't see your role? Apply here")).toBe(true);
    expect(isGeneralApplication("Senior Engineer")).toBe(false);
  });
});

describe("functions, industries and tags", () => {
  it("title first, then departments; at most two", () => {
    expect(jobFunctions(["Sales"], "Account Executive")).toEqual(["sales"]);
    expect(jobFunctions(["Engineering"], "Manager, Technical Support (APAC)")).toEqual(["customer-success", "engineering"]);
    expect(jobFunctions(["Design, Engineering, Product Management"], "Professional Services Operations Coordinator")).toEqual(["operations", "engineering"]);
    expect(jobFunctions(["People"], "Recruiter")).toEqual(["people"]);
    expect(jobFunctions(["Applications (General)"], "Join our Talent Community")).toEqual([]);
    expect(jobFunctions([], "Senior Software Engineer").length).toBe(1);
  });
  it("maps free-text industries through aliases and the core matcher", () => {
    expect(industryCodes(["any"])).toEqual([]);
    expect(industryCodes(["fintech"])).toEqual(["finance.fintech-payments"]);
    expect(industryCodes(["health", "ai"])).toEqual(["life-sciences-healthcare", "ai-data"]);
    expect(industryCodes(["film", "tv"])).toEqual(["media-entertainment.film-tv"]);
    expect(industryCodes(["no-such-industry-xyz"])).toEqual([]);
  });
  it("tags seniority, contract, workplace and named skills", () => {
    const tags = jobTags({ title: "Senior Backend Engineer (Go, Kubernetes)", employmentType: "Full Time", remote: "remote", text: "We use Python and Kafka. Python everywhere. Kafka streams." });
    expect(tags).toEqual(expect.arrayContaining(["senior", "full-time", "remote", "kubernetes", "python", "kafka"]));
    expect(tags.length).toBeLessThanOrEqual(12);
    expect(jobTags({ title: "Associate Director, Finance" })).not.toContain("entry-level");
    expect(jobTags({ title: "Software Engineer - 12 Month Fixed Term Contract" })).toContain("contract");
  });
});

describe("eligibility facts stated in postings", () => {
  it("reads minimum years only when stated", () => {
    expect(parseMinYears("You have 5+ years of experience in sales.")).toBe(5);
    expect(parseMinYears("3–5 years of experience in Professional Services Operations")).toBe(3);
    expect(parseMinYears("at least 2 years of relevant industry experience")).toBe(2);
    expect(parseMinYears("We have been around for 10 years.")).toBeNull();
    expect(parseMinYears(null)).toBeNull();
  });
  it("students-only only when explicit", () => {
    expect(statesStudentsOnly("You must be currently enrolled in a degree program.")).toBe(true);
    expect(statesStudentsOnly("Great for recent graduates.")).toBeNull();
  });
});

describe("language detection", () => {
  it("detects scripts and common Latin languages", () => {
    expect(detectLanguage("We are looking for an engineer who will work with the team and our customers on the product.")).toBe("en");
    expect(detectLanguage("Wir suchen eine Person mit Erfahrung, die mit uns und dem Team an der Plattform für Kunden arbeitet.")).toBe("de");
    expect(detectLanguage("我们正在寻找一位有经验的工程师加入我们的团队，负责后端系统的设计与开发。")).toBe("zh");
    expect(detectLanguage("私たちはエンジニアを募集しています。チームと一緒に新しいサービスを作りましょう。")).toBe("ja");
    expect(detectLanguage("hi")).toBeNull();
  });
});

describe("money, fees, equity", () => {
  it("finds amounts with explicit currencies", () => {
    expect(moneyMentions("CAD $70,000 per year").map((m) => [m.amount, m.currency])).toEqual([[70000, "CAD"]]);
    expect(moneyMentions("About HK$430,000 per year").map((m) => [m.amount, m.currency])).toEqual([[430000, "HKD"]]);
    expect(moneyMentions("€1.5 million").map((m) => m.amount)).toEqual([1500000]);
    expect(moneyMentions("¥200,000")).toEqual([]);
    expect(moneyMentions("¥200,000", { countries: ["JP"] }).map((m) => m.currency)).toEqual(["JPY"]);
  });
  it("reads headline amounts conservatively", () => {
    expect(parseMoney("$500,000 ($125K for 7% plus $375K uncapped MFN SAFE)", "investment")).toEqual({ kind: "investment", min: 500000, max: 500000, currency: "USD", period: null });
    expect(parseMoney("Up to £280,000 over two years", "grant")).toEqual({ kind: "grant", min: null, max: 280000, currency: "GBP", period: null });
    expect(parseMoney("$101,401-$131,826 annual stipend", "stipend")).toEqual({ kind: "stipend", min: 101401, max: 131826, currency: "USD", period: "year" });
    expect(parseMoney("JPY 362,000 per month, round-trip airfare", "stipend")?.period).toBe("month");
  });
  it("refuses vague, buried, mixed-currency, credit or in-kind amounts", () => {
    expect(parseMoney("Varies by region, e.g. up to US$85K/yr", "stipend")).toBeNull();
    expect(parseMoney("Travel and living expenses covered; some linked awards carry $10,000", "grant")).toBeNull();
    expect(parseMoney("$10,000 or €9,000", "prize")).toBeNull();
    expect(parseMoney("Up to $150,000 in Azure credits", "investment")).toBeNull();
    expect(parseMoney("About $197K in listed prizes (mostly sponsor in-kind)", "prize")).toBeNull();
    expect(parseMoney("Living allowance", "stipend")).toBeNull();
  });
  it("application fees only when the text says it is one", () => {
    expect(parseApplicationFee("$35 application fee")).toEqual({ amount: 35, currency: "USD" });
    expect(parseApplicationFee("£15 per entry (free voucher available via survey)")).toEqual({ amount: 15, currency: "GBP" });
    expect(parseApplicationFee("No application fee; 2026 program fee about $2,590–$2,863/month")).toBeNull();
    expect(parseApplicationFee("Ticket price varies by local event")).toBeNull();
  });
  it("equity percentages", () => {
    expect(parseEquityPercent("7%")).toBe(7);
    expect(parseEquityPercent("Typically 5% common equity")).toBe(5);
    expect(parseEquityPercent("none")).toBe(0);
    expect(parseEquityPercent("optional SAFE-style $10k at $1B cap")).toBeNull();
    expect(parseEquityPercent(null)).toBeNull();
  });
});

describe("materials", () => {
  it("maps research-team words to material ids by type and reports the rest", () => {
    expect(mapMaterials(["cv", "references", "proposal"], "fellowship")).toEqual({ ids: ["cv", "recommendation_letters", "research_proposal"], unknown: [] });
    expect(mapMaterials(["proposal", "budget"], "grant").ids).toEqual(["grant_application", "financial_summary"]);
    expect(mapMaterials(["deck", "video"], "accelerator").ids).toEqual(["pitch_deck", "demo_video"]);
    expect(mapMaterials(["statement", "images"], "residency").ids).toEqual(["artist_statement", "work_samples"]);
    expect(mapMaterials(["passport_copy", "mystery_doc"], "scholarship")).toEqual({ ids: ["document_checklist"], unknown: ["mystery_doc"] });
  });
});

describe("dates and quality", () => {
  it("deadlines are the end of the stated day in UTC; invalid dates are null", () => {
    expect(deadlineFromDate("2026-11-02")?.toISOString()).toBe("2026-11-02T23:59:59.000Z");
    expect(deadlineFromDate("2026-02-30")).toBeNull();
    expect(deadlineFromDate("soon")).toBeNull();
    expect(deadlineFromDate(null)).toBeNull();
  });
  it("job quality rewards complete, fresh postings and demotes talent pools", () => {
    const now = new Date("2026-10-21T00:00:00Z");
    const full = jobQuality({ descriptionLength: 1200, hasCountryOrRemote: true, hasSalary: true, functions: 1, publishedAt: new Date("2026-10-10T00:00:00Z"), general: false, now });
    const pool = jobQuality({ descriptionLength: 1200, hasCountryOrRemote: true, hasSalary: false, functions: 0, publishedAt: null, general: true, now });
    expect(full).toBe(95);
    expect(pool).toBeLessThan(40);
  });
});
