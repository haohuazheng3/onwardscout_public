import { describe, expect, it } from "vitest";
import {
  APPLICATION_ID,
  escapeHtml,
  newSandboxRef,
  renderConfirmation,
  renderForm,
  SANDBOX_FIELD_ORDER,
  SANDBOX_REF,
  validateSubmission,
} from "@/app/sandbox/form/render";
import { newId } from "@/lib/ids";

function baseForm(): FormData {
  const f = new FormData();
  f.set("full_name", "Ada Test");
  f.set("email", "ada@example.com");
  f.set("location", "Berlin, Germany");
  f.set("motivation", "I want to rehearse the whole application flow end to end.");
  f.set("proud_project", "A small parser that reads résumés and cites every fact it extracts.");
  f.set("availability", "2-weeks");
  f.set("consent", "yes");
  return f;
}

const pdf = (name = "resume.pdf", bytes = 1200, type = "application/pdf") => new File([new Uint8Array(bytes)], name, { type });

describe("sandbox form validation", () => {
  it("requires a résumé file for multipart submissions (the form's own encoding)", () => {
    const r = validateSubmission(baseForm());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors)).toEqual(["resume"]);
  });

  it("accepts a urlencoded submission without a file (that encoding cannot carry one)", () => {
    const r = validateSubmission(baseForm(), { requireFile: false });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.files).toEqual([]);
  });

  it("stores file metadata only, and still checks a file that does arrive", () => {
    const f = baseForm();
    f.set("resume", pdf());
    const ok = validateSubmission(f);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.files).toEqual([{ field: "resume", name: "resume.pdf", size: 1200, type: "application/pdf" }]);

    const bad = baseForm();
    bad.set("resume", pdf("resume.exe", 10, "application/octet-stream"));
    const r = validateSubmission(bad, { requireFile: false });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.resume).toMatch(/PDF or DOCX/);
  });

  it("keeps a valid application id and drops a malformed one", () => {
    const id = newId("app");
    expect(APPLICATION_ID.test(id)).toBe(true);
    const f = baseForm();
    f.set("application_id", id);
    const r = validateSubmission(f, { requireFile: false });
    expect(r.ok && r.fields.application_id).toBe(id);

    const g = baseForm();
    g.set("application_id", "app_<script>");
    const s = validateSubmission(g, { requireFile: false });
    expect(s.ok && s.fields.application_id).toBeFalsy();
  });

  it("reports one human sentence per invalid field", () => {
    const f = new FormData();
    f.set("email", "not-an-email");
    f.set("availability", "someday");
    const r = validateSubmission(f, { requireFile: false });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      for (const k of ["full_name", "email", "location", "motivation", "proud_project", "availability", "consent"]) {
        expect(r.errors[k as keyof typeof r.errors], k).toMatch(/\.$/);
      }
    }
  });
});

describe("sandbox form rendering", () => {
  it("mints references in the SBX-XXXXXX shape", () => {
    for (let i = 0; i < 50; i++) expect(newSandboxRef()).toMatch(SANDBOX_REF);
  });

  it("puts the reference in #confirmation-ref and escapes user input", () => {
    const html = renderConfirmation({ ref: "SBX-7KQ2M9", name: "<img src=x onerror=alert(1)>", email: "a@b.co" });
    expect(html).toMatch(/id="confirmation-ref"[^>]*>SBX-7KQ2M9</);
    expect(html).not.toContain("<img src=x");
    expect(escapeHtml(`"<'&>`)).toBe("&quot;&lt;&#39;&amp;&gt;");
  });

  it("renders every field in order with an error summary when invalid", () => {
    const page = renderForm({ errors: { email: "Enter an email address like name@example.com." }, values: { email: "x" } });
    expect(page).toContain('role="alert"');
    let last = -1;
    for (const name of SANDBOX_FIELD_ORDER) {
      const at = page.indexOf(`name="${name}"`);
      expect(at, name).toBeGreaterThan(last);
      last = at;
    }
  });
});
