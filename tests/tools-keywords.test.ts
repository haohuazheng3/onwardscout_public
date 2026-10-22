import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { extractKeywords, matchKeywords } from "@/components/tools/Keywords";

// Keywords.tsx imports the shared tool helpers (consent banner, next/link); only the pure functions are tested here.
vi.mock("@/components/Consent", () => ({ track: () => {} }));
vi.mock("next/link", () => ({ default: () => null }));

/* Regression tests for the résumé keyword matcher: plurals, slash lists, "&" names, repeated names
 * inside one-off phrases, hyphen spellings, stop words, .NET / R / C and accented letters. */

// The tool definitions live in the private repository only; the public mirror skips these.
const file = path.join(process.cwd(), "content", "tools", "resume-keyword-matcher.json");
const hasTool = fs.existsSync(file);
const stop: string[] = hasTool ? JSON.parse(fs.readFileSync(file, "utf8")).extraStopwords : [];
const pad = "\nAbout us: we are a growing company with offices in several cities and a friendly culture where everyone is welcome and heard by all of us every single day.";

/** phrase → present, as the tool would show it for this posting (padded past the 25-word minimum) and résumé. */
function check(jd: string, cv: string): Record<string, boolean> {
  return Object.fromEntries(matchKeywords(jd + pad, cv, 30, stop).map((h) => [h.phrase, h.present]));
}
const phrases = (jd: string) => extractKeywords(jd + pad, 30, stop).map((k) => k.phrase);

describe.skipIf(!hasTool)("plurals", () => {
  it("matches irregular and acronym plurals against the singular in the résumé", () => {
    expect(check("Requirements: experience with APIs. You will design APIs and document APIs.", "Designed a public API used by 200 partners.").apis).toBe(true);
    expect(check("Requirements: experience designing an API. The API is core. Own the API.", "Shipped 14 public APIs.").api).toBe(true);
    expect(check("Track KPIs weekly. Requirements: KPIs reporting. Own KPIs.", "Built KPI dashboards for sales.").kpis).toBe(true);
    expect(check("Run surveys monthly. Requirements: experience with surveys. Analyze surveys.", "Designed a customer survey for 3,000 users.").surveys).toBe(true);
    expect(check("Define metrics for the team. Requirements: experience with metrics. Report metrics weekly.", "Defined the north-star metric for growth.").metrics).toBe(true);
    expect(check("Lead product launches. Requirements: experience with product launches. Plan product launches.", "Led the product launch of our mobile app.")["product launches"]).toBe(true);
    expect(check("Improve processes. Requirements: experience improving processes. Document processes.", "Redesigned the claims process, cutting cycle time 30%.").processes).toBe(true);
    expect(check("Prepare taxes for clients. Requirements: experience with taxes. Review taxes.", "Prepared individual and corporate tax returns.").taxes).toBe(true);
    expect(check("Map customer journeys. Requirements: experience with customer journeys. Improve customer journeys.", "Mapped the end-to-end customer journey.")["customer journeys"]).toBe(true);
    const fin = "Prepare variance analyses monthly. Requirements: experience with variance analyses. Present variance analyses.";
    expect(check(fin, "Monthly variance analysis for a $40M P&L.")["variance analyses"]).toBe(true);
    const rn = "Formulate nursing diagnoses. Requirements: nursing diagnoses per NANDA. Update nursing diagnoses.";
    expect(check(rn, "Wrote nursing diagnosis and care plan for each patient.")["nursing diagnoses"]).toBe(true);
    const mix = "Requirements: mobile apps. Build mobile apps. Mobile apps daily. Tune caches. Redis caches daily. Test approaches. New approaches. Train on GPUs. GPUs daily.";
    expect(check(mix, "Built a mobile app; Redis cache; approach; GPU.")).toMatchObject({ "mobile apps": true, caches: true, approaches: true, gpus: true });
  });
  it("never reads news as new, and leaves analytics, status, sales and SaaS alone", () => {
    expect(check("Requirements: pitch stories to news outlets. Monitor news daily. Write news briefs.", "Launched a new product line.").news).toBe(false);
    const jd = "Requirements: analytics, status reports, sales, business. Analytics daily. Sales daily. DevOps on AWS. SaaS growth. DevOps and AWS. SaaS sales. Status reports weekly.";
    expect(check(jd, "Analytics, status reports, sales, business, DevOps, AWS, SaaS.")).toMatchObject({ analytics: true, "status reports": true, sales: true, devops: true, aws: true, saas: true });
  });
});

describe.skipIf(!hasTool)("slash lists", () => {
  it("splits a list of skills on both sides", () => {
    expect(check("Requirements: Python/SQL. You will write Python/SQL daily. Python/SQL pipelines.", "Skills: Python, SQL, Tableau.")).toMatchObject({ python: true, sql: true });
    expect(check("Requirements: strong Python. Write Python daily. Python services.", "Skills: Python/SQL/Tableau.").python).toBe(true);
    expect(check("Requirements: AWS/GCP. Deploy to AWS/GCP. Run AWS/GCP infrastructure.", "Deployed services on AWS (EC2, S3) and GCP.")).toMatchObject({ aws: true, gcp: true });
    expect(check("Requirements: C/C++ development. Write C/C++ firmware. Debug C/C++ code.", "Firmware in C and C++ for ARM microcontrollers.")).toMatchObject({ c: true, "c++": true });
    expect(phrases("Requirements: Node.js/React. Build Node.js/React apps. Node.js/React daily.")).toEqual(expect.arrayContaining(["node.js", "react"]));
    expect(phrases("Requirements: Current BLS/ACLS certification. Maintain BLS/ACLS. BLS/ACLS required.").some((p) => p.includes("/"))).toBe(false);
  });
  it("keeps single terms whole, also at the end of a sentence", () => {
    const hits = check("Requirements: Own CI/CD. Strong UI/UX. Improve CI/CD.", "Built CI pipelines.");
    expect(hits["ci/cd"]).toBe(false);
    expect(Object.keys(hits)).not.toEqual(expect.arrayContaining(["ci"]));
    expect(check("Requirements: PL/SQL. Write PL/SQL daily. PL/SQL packages.", "Wrote SQL reports.")).toEqual({ "pl/sql": false });
    expect(phrases("Requirements: TCP/IP networking. SAP S/4HANA rollout. 24/7 on-call. TCP/IP routing. SAP S/4HANA migration.")).toEqual(expect.arrayContaining(["tcp/ip", "sap s/4hana"]));
  });
});

describe.skipIf(!hasTool)("names with & and .NET", () => {
  it("keeps M&A, P&L, FP&A and R&D whole", () => {
    expect(check("Requirements: M&A experience. Support M&A deals. Model M&A transactions.", "Supported 6 M&A transactions.")["m&a"]).toBe(true);
    expect(check("Requirements: own the P&L. Report on P&L. Manage P&L for region.", "Owned a $40M P&L.")["p&l"]).toBe(true);
    expect(check("Requirements: FP&A experience. Join FP&A. Lead FP&A planning.", "FP&A analyst, 3 years.")).toEqual({ "fp&a": true });
    expect(check("Requirements: R&D experience. Partner with R&D. Lead R&D projects.", "Led sales projects.")["r&d"]).toBe(false);
    expect(phrases("Requirements: Sales & Marketing. Partner with Sales & Marketing. Sales & Marketing alignment.")).toContain("sales marketing");
  });
  it("shows .NET as .net and never matches the word net", () => {
    const jd = "Requirements: .NET experience. Build .NET services. Maintain .NET Core apps.";
    const hits = check(jd, "Revenue analyst; tracked net revenue and net income.");
    expect(hits[".net"]).toBe(false);
    expect(Object.keys(hits)).not.toContain("net");
    expect(check(jd, "Built .NET Core services.")[".net"]).toBe(true);
    expect(phrases("Requirements: ASP.NET MVC. VB.NET apps. Network security. ASP.NET daily. VB.NET maintenance. Network design.")).toEqual(expect.arrayContaining(["asp.net", "vb.net", "network"]));
  });
  it("extracts R and C written alone, but not a middle initial or a lower-case r", () => {
    const r = "Requirements: Python or R. Analyze data in R. Build R models.";
    expect(check(r, "Statistical modeling in R and Python.")).toMatchObject({ r: true, python: true });
    expect(check(r, "Statistical modeling in Python; a r value.").r).toBe(false);
    expect(check("Requirements: C programming. Write C daily. Embedded C firmware.", "Jane C. Doe, Java developer.").c).toBe(false);
  });
});

describe.skipIf(!hasTool)("repeated names inside one-off phrases", () => {
  it("keeps SQL ×3 when every mention sits in a longer phrase used once", () => {
    const jd = `Database Developer
Responsibilities
- Tune SQL queries for our reporting warehouse
- Write SQL stored procedures and views
- Administer SQL Server instances on Azure
- Partner with analysts on data models
Requirements
- 4+ years of database development
- Experience with SSIS packages and ETL design
- Familiarity with Power BI dashboards
- Strong communication with business stakeholders`;
    const hits = matchKeywords(jd, "Database developer. 5 years of SQL: query tuning, stored procedure development, SQL Server and Azure. SSIS, ETL, Power BI.", 30, stop);
    expect(hits.find((h) => h.phrase === "sql")).toMatchObject({ count: 3, present: true });
  });
  it("keeps Python and Salesforce in bullet lists, without bare verbs", () => {
    const jd = `Backend Developer
Responsibilities
- Build Python services for billing
- Write Python scripts for data jobs
- Maintain Python data pipelines
Requirements
- 3+ years of backend development
- Experience with PostgreSQL`;
    expect(phrases(jd)).toContain("python");
    expect(phrases(jd)).not.toEqual(expect.arrayContaining(["maintain"]));
    const ops = `Sales Operations Analyst
Responsibilities
- Administer Salesforce dashboards for the sales team
- Build Salesforce reports for leadership
- Clean Salesforce data weekly
Requirements
- 2+ years in sales operations`;
    expect(phrases(ops)).toContain("salesforce");
  });
});

describe.skipIf(!hasTool)("spelling variants", () => {
  it("treats hyphen, space and joined spellings as one term", () => {
    expect(check("Requirements: cross-functional leadership. Lead cross-functional teams. Drive cross-functional alignment.", "Led cross functional squads of 12.")["cross-functional"]).toBe(true);
    expect(check("Requirements: e-commerce experience. Grow e-commerce revenue. Own e-commerce roadmap.", "Grew ecommerce revenue 40%.")["e-commerce"]).toBe(true);
    expect(check("Requirements: ecommerce experience. Grow ecommerce revenue. Own ecommerce roadmap.", "Grew e-commerce revenue 40%.").ecommerce).toBe(true);
    expect(check("Requirements: go-to-market plans. Own go-to-market. Shape go-to-market.", "Wrote the go to market plan.")["go-to-market"]).toBe(true);
  });
  it("reads Salesforce.com as Salesforce but keeps Socket.io", () => {
    const hits = check("Requirements: Salesforce.com experience. Manage Salesforce.com pipeline. Update Salesforce.com daily.", "Managed pipeline in Salesforce.");
    expect(hits.salesforce).toBe(true);
    expect(Object.keys(hits).some((p) => p.includes(".com"))).toBe(false);
    expect(check("Requirements: Socket.io realtime. Build Socket.io apps. Use Socket.io daily.", "Wrote TCP socket servers.")["socket.io"]).toBe(false);
  });
});

describe.skipIf(!hasTool)("stop words", () => {
  it("drops contractions, requirement cues and third-person verbs", () => {
    const jd = `Registered Nurse
Summary: The Registered Nurse provides direct patient care and ensures patient safety. The nurse manages patient flow and supports physicians.
Requirements: Active RN license. BLS required. Experience in acute care required.
What you'll do: You'll assess patients, you'll administer medications and you'll document care in Epic. You'll love our team.`;
    const words = phrases(jd).join(" | ");
    expect(words).not.toMatch(/\b(youll|provides|ensures|manages)\b/);
    expect(phrases("Requirements: Proficient with Salesforce. Proficiency in Excel. Proficient in SQL.").join(" ")).not.toMatch(/proficien/);
  });
  it("keeps knowledge base, skilled nursing, IM injections and subject matter expertise", () => {
    expect(phrases("Requirements: maintain the knowledge base. Write knowledge base articles. Update the knowledge base.")).toContain("knowledge base");
    expect(phrases("Requirements: skilled nursing experience. Work in skilled nursing. Skilled nursing facility.")).toContain("skilled nursing");
    expect(check("Requirements: give IM injections. Administer IM injections. IM injections daily.", "Gave IM injections.")["im injections"]).toBe(true);
    expect(phrases("Requirements: subject matter expertise in tax. Share subject matter expertise. Bring subject matter expertise.")).toContain("subject matter expertise");
  });
});

describe.skipIf(!hasTool)("accented letters", () => {
  it("folds accents so words stay whole and match either spelling", () => {
    const jd = `Machine Learning Engineer – Montréal (hybrid)
Our Montréal team builds recommendation models for clients across Québec.
Responsibilities
- Train and deploy models (XGBoost, Naïve Bayes, logistic regression) in Python
- Partner with the Montréal data platform team
Requirements
- 3+ years of experience with Python and scikit-learn
- Experience with Naïve Bayes and gradient boosting
- French is an asset; send your résumé in English or French`;
    const hits = Object.fromEntries(matchKeywords(jd, "ML engineer. Python, scikit-learn, XGBoost, Naive Bayes, logistic regression. Based in Montreal.", 30, stop).map((h) => [h.phrase, h.present]));
    expect(hits).toMatchObject({ "naive bayes": true, montreal: true });
    expect(Object.keys(hits).join(" | ")).not.toMatch(/\b(na ve|montr al|sum)\b/);
    expect(check("Requirements: Montreal office. Based in Montreal. Montreal team.", "Based in Montréal.").montreal).toBe(true);
  });
  it("does not let a hyphenated compound in the résumé satisfy a one-word keyword", () => {
    const jd = "Requirements: Go. Write Go services. Go daily. Go microservices.";
    expect(matchKeywords(jd, "Led SAP go-live support.", 30).find((h) => h.phrase === "go")?.present).toBe(false);
  });
  it("keeps four-letter capital names that end in S whole", () => {
    const jd = "Requirements: HIV/AIDS outreach. AIDS education. AIDS clinics.";
    expect(matchKeywords(jd, "Financial aid counselor.", 30).find((h) => h.phrase.includes("aids"))?.present).toBe(false);
  });
  it("finds R at the end of a sentence but not a middle initial", () => {
    const jd = "Requirements: Python or R. Analyze data in R. Build R models.";
    expect(matchKeywords(jd, "Built churn models in R. Deployed them with Python.", 30).find((h) => h.phrase === "r")?.present).toBe(true);
    expect(matchKeywords(jd, "Mary R Jones, analyst.", 30).find((h) => h.phrase === "r")?.present).toBe(false);
  });
  it("splits C#/.NET and shows each displayed keyword once", () => {
    const jd = "Requirements: C#/.NET. Build C#/.NET services. Maintain C#/.NET apps. Review PRs. Merge PRs daily. Open prs quickly. Comment on prs.";
    const hits = matchKeywords(jd, "C# and .NET Core developer.", 30);
    expect(hits.find((h) => h.phrase === ".net")?.present).toBe(true);
    const phrases = hits.map((h) => h.phrase);
    expect(new Set(phrases).size).toBe(phrases.length);
  });
});
