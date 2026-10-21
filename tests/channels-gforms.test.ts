import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isGoogleFormUrl } from "@/lib/channels/detect";
import {
  buildGooglePayload,
  extractLoadData,
  formResponseUrl,
  googleFormRequirements,
  isGoogleSignInPage,
  parseGoogleForm,
  readGoogleConfirmation,
} from "@/lib/channels/gforms";

const html = readFileSync(path.join(import.meta.dirname, "fixtures", "channels", "google-form.html"), "utf8");
const PAGE = "https://docs.google.com/forms/d/e/1FAIpQLSfTESTFIXTUREONLY000000000/viewform?usp=sf_link";

describe("Google Forms page parsing", () => {
  const form = parseGoogleForm(html, PAGE)!;

  it("extracts the FB_PUBLIC_LOAD_DATA_ array without executing anything", () => {
    const data = extractLoadData(html);
    expect(Array.isArray(data)).toBe(true);
    expect(extractLoadData("<html>no data</html>")).toBeNull();
    expect(extractLoadData("var FB_PUBLIC_LOAD_DATA_ = [1, 2, ")).toBeNull();
  });

  it("reads title, description, pages and the formResponse action", () => {
    expect(form.title).toBe("Community Builders Grant — Application");
    expect(form.description).toMatch(/grant committee/);
    expect(form.pages).toBe(2);
    expect(form.action).toBe("https://docs.google.com/forms/u/0/d/e/1FAIpQLSfTESTFIXTUREONLY000000000/formResponse");
    expect(form.fbzx).toBe("-4563215478123");
    expect(form.requiresLogin).toBe(false);
  });

  it("turns questions into ordered entry fields and skips text blocks and section breaks", () => {
    expect(form.fields.map((f) => f.name)).toEqual([
      "entry.2000001",
      "entry.2000002",
      "entry.2000003",
      "entry.2000004",
      "entry.2000005",
      "entry.2000006",
      "entry.2000008",
      "entry.2000009",
    ]);
    const [name, email, track, country, resources, scale, project, start] = form.fields;
    expect(name).toMatchObject({ label: "Full name", type: "text", required: true, page: 0 });
    expect(email).toMatchObject({ label: "Email address", type: "text", required: true });
    expect(track).toMatchObject({ type: "select", required: true, hasOther: true, help: "Pick the one that fits best." });
    expect(track.options?.map((o) => o.label)).toEqual(["Education", "Climate", "Health"]);
    expect(country).toMatchObject({ type: "select", gtype: 3, required: true });
    expect(resources).toMatchObject({ type: "multiselect", required: false });
    expect(scale.options?.map((o) => o.value)).toEqual(["1", "2", "3", "4", "5"]);
    expect(project).toMatchObject({ type: "textarea", required: true, page: 1 });
    expect(start).toMatchObject({ type: "date", required: false, page: 1 });
  });

  it("produces contract requirements with semantic keys and page sections", () => {
    const req = googleFormRequirements(form);
    expect(req[0]).toMatchObject({ name: "entry.2000001", key: "full_name", profilePath: "/identity/name", section: "Page 1" });
    expect(req[1]).toMatchObject({ key: "email" });
    expect(req.find((f) => f.name === "entry.2000008")).toMatchObject({ question: true, section: "Page 2" });
  });

  it("collects the respondent email when the form asks for it (responder input)", () => {
    const withEmail = html.replace("[null,null,null,3,null,null,1]", "[null,null,null,3,null,null,3]");
    const f = parseGoogleForm(withEmail, PAGE)!;
    expect(f.fields[0]).toMatchObject({ name: "emailAddress", type: "email", required: true });
  });

  it("knows when Google requires a sign-in (verified email, file upload)", () => {
    const verified = parseGoogleForm(html.replace("[null,null,null,3,null,null,1]", "[null,null,null,3,null,null,2]"), PAGE)!;
    expect(verified.requiresLogin).toBe(true);
    expect(verified.loginReasons).toContain("verified_email");
    const upload = parseGoogleForm(html.replace('[100009,"Expected start date",null,9,', '[100011,"Upload your CV",null,13,[[2000011,null,1]]],[100009,"Expected start date",null,9,'), PAGE)!;
    expect(upload.requiresLogin).toBe(true);
    expect(upload.loginReasons).toContain("file_upload");
    expect(isGoogleSignInPage("https://accounts.google.com/v3/signin/identifier?continue=x", "<html></html>")).toBe(true);
    expect(isGoogleSignInPage(PAGE, html)).toBe(false);
  });
});

describe("Google Forms submission payload", () => {
  const form = parseGoogleForm(html, PAGE)!;

  it("encodes answers the way the page itself does", () => {
    const { body, missing, unmatched } = buildGooglePayload(form, {
      "entry.2000001": "Amara Okafor",
      "entry.2000002": "amara@example.com",
      "entry.2000003": "Climate",
      "entry.2000004": "germany",
      "entry.2000005": '["Mentorship","Funding"]',
      "entry.2000006": "4",
      "entry.2000008": "A repair café network that keeps 2 tonnes of electronics out of landfill each year.",
      "entry.2000009": "2027-03-01",
    });
    expect(missing).toEqual([]);
    expect(unmatched).toEqual([]);
    const p = new URLSearchParams(body);
    expect(p.get("entry.2000001")).toBe("Amara Okafor");
    expect(p.get("entry.2000004")).toBe("Germany");
    expect(p.getAll("entry.2000005")).toEqual(["Mentorship", "Funding"]);
    expect(p.get("entry.2000009_year")).toBe("2027");
    expect(p.get("entry.2000009_month")).toBe("3");
    expect(p.get("entry.2000009_day")).toBe("1");
    expect(p.get("fvv")).toBe("1");
    expect(p.get("pageHistory")).toBe("0,1");
    expect(p.get("fbzx")).toBe("-4563215478123");
  });

  it("uses the Other option for an answer outside the list, and reports gaps", () => {
    const { body, missing } = buildGooglePayload(form, { "entry.2000003": "Arts & culture", "entry.2000001": "A. O." });
    const p = new URLSearchParams(body);
    expect(p.get("entry.2000003")).toBe("__other_option__");
    expect(p.get("entry.2000003.other_option_response")).toBe("Arts & culture");
    expect(missing).toEqual(["Email address", "Country of residence", "How ready is your project?", "Describe your project (up to 200 words)"]);
  });

  it("refuses a choice that matches no option when there is no Other", () => {
    const { unmatched } = buildGooglePayload(form, { "entry.2000004": "Atlantis" });
    expect(unmatched).toEqual(["Country of residence"]);
  });

  it("accepts answers keyed by label or bare entry id", () => {
    const { body } = buildGooglePayload(form, { "Full name": "Li Wei", "2000002": "li@example.com" });
    const p = new URLSearchParams(body);
    expect(p.get("entry.2000001")).toBe("Li Wei");
    expect(p.get("entry.2000002")).toBe("li@example.com");
  });
});

describe("Google Forms helpers", () => {
  it("derives the formResponse URL", () => {
    expect(formResponseUrl(PAGE)).toBe("https://docs.google.com/forms/d/e/1FAIpQLSfTESTFIXTUREONLY000000000/formResponse");
  });
  it("recognises form URLs", () => {
    expect(isGoogleFormUrl(PAGE)).toBe(true);
    expect(isGoogleFormUrl("https://forms.gle/AbCdEf123")).toBe(true);
    expect(isGoogleFormUrl("https://docs.google.com/document/d/x")).toBe(false);
    expect(isGoogleFormUrl("https://example.com/forms/x")).toBe(false);
  });
  it("reads Google's confirmation page", () => {
    expect(readGoogleConfirmation('<div class="vHW8K">Thanks! Your application for the grant was received.</div>')).toEqual({
      confirmed: true,
      text: "Thanks! Your application for the grant was received.",
    });
    expect(readGoogleConfirmation("<div>Your response has been recorded.</div>").confirmed).toBe(true);
    expect(readGoogleConfirmation(html).confirmed).toBe(false);
  });
});
