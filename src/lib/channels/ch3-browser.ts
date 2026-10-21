import "server-only";
import { features } from "@/lib/env";
import { captureError } from "@/lib/errors";
import { putObject, screenKey } from "@/lib/files";
import { assertPublicUrl, isPrivateAddress, systemResolver } from "@/lib/ingest/url";
import { fieldKey, getIntelligence } from "@/lib/llm";
import type { Opportunity } from "@/lib/db/schema";
import { detectBlockers, forbiddenPlatform, hostAllowed, hostOf } from "./detect";
import { loadPersonContext } from "./context";
import { loadPreparedFiles, loadPreparedFile } from "./files";
import { buildHandoff } from "./handoff";
import { channelGet, isTrustedOrigin, networkMessage } from "./http";
import { formToRequirements, parseHtmlForms, pickMainForm, questionsOf, readResponse, TRUE_RE } from "./html-form";
import type { Channel, ChannelDeps, FieldRequirement, LoadedFile, Requirements, SubmitContext, SubmitResult } from "./types";

/*
 * CH3 — the browser agent. Opens the official form in headless Chromium (playwright-core +
 * @sparticuz/chromium on Vercel, the local Chrome elsewhere), maps each field by its
 * accessible label (getIntelligence().mapFormFields), fills, uploads, screenshots every step
 * into R2, and submits only after the person confirmed (`dryRun` = fill and stop).
 *
 * Hard rules: the agent acts only on the apply URL's host (navigations elsewhere are blocked);
 * page text is data handed to the planner, never instructions; CAPTCHA, login, payment, EEO
 * and signatures stop it with a handoff; the whole run has a 120-second budget.
 */

const DEFAULT_BUDGET_MS = 120_000;
const MAX_STEPS = 40;
const AX_LIMIT = 24_000;

type Lang = "en" | "zh";

export function browserAgentEnabled(deps?: ChannelDeps): boolean {
  return deps?.browserEnabled ?? features().browserAgent;
}

function emptyRequirements(opp: Opportunity, notes: string[] = []): Requirements {
  return {
    channel: "CH3",
    fields: opp.apply.fieldsSchema.map((f) => ({
      name: f.name,
      label: f.label,
      type: f.type,
      required: f.required,
      ...(f.options ? { options: f.options.map((o) => o.label), choices: f.options } : {}),
      ...(f.maxLength ? { maxLength: f.maxLength } : {}),
      ...(f.profilePath ? { profilePath: f.profilePath } : {}),
    })),
    materials: [...opp.requiredMaterials],
    questions: [],
    requiresAccount: opp.apply.requiresAccount,
    requiresPayment: opp.apply.requiresPayment,
    captchaLikely: opp.apply.captchaLikely,
    ...(opp.apply.url ? { submitUrl: opp.apply.url } : {}),
    notes,
  };
}

async function analyze(opp: Opportunity): Promise<Requirements> {
  const url = opp.apply.url ?? opp.url;
  const base = emptyRequirements(opp, ["We open the official form in a browser and fill it from your profile. Nothing is submitted until you confirm."]);
  if (!url) return { ...base, notes: [...base.notes, "This opportunity has no application link yet."] };
  try {
    const page = await channelGet(url);
    const blockers = detectBlockers(page.html);
    const form = pickMainForm(parseHtmlForms(page.html, page.url));
    const fields = form ? formToRequirements(form) : base.fields;
    return {
      ...base,
      fields,
      questions: questionsOf(fields),
      submitUrl: page.url,
      captchaLikely: base.captchaLikely || blockers.captcha,
      requiresAccount: base.requiresAccount || blockers.login,
      requiresPayment: base.requiresPayment || blockers.payment,
      notes: [
        ...base.notes,
        ...(blockers.captcha ? ["This form uses a CAPTCHA, so you'll finish it yourself, with every answer ready to copy."] : []),
        ...(!form ? ["The form is drawn by JavaScript; we'll read its fields when we open it."] : []),
      ],
    };
  } catch (err) {
    return { ...base, notes: [...base.notes, `We couldn't read the form in advance: ${networkMessage(err)}`] };
  }
}

/* ------------------------------------------------------------------ the agent */

export interface BrowserRunInput {
  userId: string;
  applicationId: string;
  url: string;
  /** The only host the agent may act on (the apply URL's host). */
  allowedHost: string;
  answers: Record<string, string>;
  files: LoadedFile[];
  /** P3a's field list for this form (labels help match), optional. */
  fields?: FieldRequirement[];
  goal: string;
  dryRun?: boolean;
  deps?: ChannelDeps;
}

export type BrowserRunResult =
  | { status: "submitted"; confirmationText?: string; url: string; ref?: string; screenshotKey?: string }
  | { status: "ready"; url: string; screenshotKey?: string; filled: number }
  | { status: "needs_you"; reason: "captcha" | "login" | "payment" | "blocked" | "unsupported"; note: string; screenshotKey?: string }
  | { status: "failed"; error: string; retryable: boolean; screenshotKey?: string };

interface DomField {
  name: string;
  label: string;
  type: string;
  required: boolean;
  options: { value: string; label: string }[];
}

type PwPage = import("playwright-core").Page;
type PwBrowser = import("playwright-core").Browser;

/** Local names Chromium must never resolve (defence in depth next to the per-request check). */
const HOST_RESOLVER_RULES = "--host-resolver-rules=MAP localhost ~NOTFOUND, MAP *.localhost ~NOTFOUND, MAP *.local ~NOTFOUND, MAP *.internal ~NOTFOUND, MAP metadata.google.internal ~NOTFOUND";

async function launch(): Promise<PwBrowser> {
  const { chromium } = await import("playwright-core");
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    const sparticuz = (await import("@sparticuz/chromium")).default;
    return chromium.launch({ args: [...sparticuz.args, HOST_RESOLVER_RULES], executablePath: await sparticuz.executablePath(), headless: true });
  }
  const executablePath = process.env.CHROME_EXECUTABLE_PATH?.trim();
  if (executablePath) return chromium.launch({ executablePath, headless: true, args: [HOST_RESOLVER_RULES] });
  try {
    return await chromium.launch({ channel: "chrome", headless: true, args: [HOST_RESOLVER_RULES] });
  } catch {
    return chromium.launch({ headless: true, args: [HOST_RESOLVER_RULES] });
  }
}

/**
 * Network guard for everything the browser loads (pages, frames, scripts, images, fetch/XHR,
 * WebSockets): http(s) only, standard ports, and a host whose every DNS answer is public — the
 * same rules as safeFetch (contracts-foundation §5.3). Our own origin (the sandbox) is trusted.
 * Answers are cached per host for one run.
 */
export function createRequestGuard(resolver = systemResolver): (url: string) => Promise<boolean> {
  const hosts = new Map<string, Promise<boolean>>();
  return async (url: string) => {
    if (isTrustedOrigin(url)) return true;
    let u: URL;
    try {
      u = assertPublicUrl(url);
    } catch {
      return false;
    }
    const host = u.hostname.replace(/^\[|\]$/g, "");
    let verdict = hosts.get(host);
    if (!verdict) {
      verdict = resolver(host).then(
        (all) => all.length > 0 && !all.some((a) => isPrivateAddress(a.address)),
        () => false,
      );
      hosts.set(host, verdict);
    }
    return verdict;
  };
}

function answerFor(answers: Record<string, string>, label: string): string {
  const want = label.trim().toLowerCase();
  for (const [k, v] of Object.entries(answers)) if (k.trim().toLowerCase() === want) return (v ?? "").trim();
  return "";
}

/**
 * Deterministic guard on the planner's actions (contracts §5.1: consent, EEO, signatures,
 * passwords, payment and date of birth are decided by rules, never by the model). A step that
 * touches such a field is refused unless the person answered that very field in Onward Scout
 * (consent: with a "yes"); a typed value must be one of the prepared values.
 */
export function guardBrowserStep(
  step: { action: string; target: string | null; value: string | null },
  ctx: { values: Record<string, string>; answers: Record<string, string>; groupLabel?: string | null },
): { ok: true } | { ok: false; reason: string } {
  if (!["fill", "select", "check", "uncheck", "click", "upload", "submit"].includes(step.action)) return { ok: true };
  const t = parseTarget(step.target);
  const labels = [t?.name ?? "", ctx.groupLabel ?? ""].filter(Boolean);
  for (const label of labels) {
    const key = fieldKey({ name: label, label, placeholder: null });
    if (!key?.user) continue;
    if (step.action === "submit" || (step.action === "click" && t?.role === "button" && key.key !== "consent")) continue; // a "Submit"/"I agree and submit" button is the submit gate, not a field
    const answer = answerFor(ctx.answers, label);
    if (key.key === "consent") {
      if ((step.action === "check" || step.action === "click") && TRUE_RE.test(answer)) return { ok: true };
      return { ok: false, reason: `“${label.slice(0, 80)}” is a consent box: only you can tick it.` };
    }
    if (answer && (step.action !== "fill" || (step.value ?? "") === answer)) return { ok: true };
    return { ok: false, reason: `“${label.slice(0, 80)}” is yours to answer on the official form.` };
  }
  if (step.action === "fill" && step.value) {
    const prepared = new Set([...Object.values(ctx.values), ...Object.values(ctx.answers)].map((v) => (v ?? "").trim()));
    if (!prepared.has(step.value.trim())) return { ok: false, reason: "The agent tried to type something that wasn't prepared and confirmed." };
  }
  return { ok: true };
}

/** The visible text a person would see first: title, headings, alerts (data for the planner). */
async function pageSummary(page: PwPage): Promise<string> {
  return page
    .evaluate(() => {
      const pick = (sel: string) =>
        Array.from(document.querySelectorAll(sel))
          .map((e) => (e as HTMLElement).innerText?.replace(/\s+/g, " ").trim() ?? "")
          .filter(Boolean)
          .slice(0, 12);
      return [document.title, ...pick("h1, h2, [role=alert], .error, .notice, p.lede"), ...pick("main p").slice(0, 4)].join("\n").slice(0, 3000);
    })
    .catch(() => "");
}

async function domFields(page: PwPage): Promise<DomField[]> {
  return page
    .evaluate(() => {
      const out: { name: string; label: string; type: string; required: boolean; options: { value: string; label: string }[] }[] = [];
      const seen = new Set<string>();
      const labelOf = (el: HTMLElement): string => {
        const input = el as HTMLInputElement;
        const fromLabels = input.labels && input.labels.length ? Array.from(input.labels).map((l) => l.innerText).join(" ") : "";
        const aria = el.getAttribute("aria-label") ?? "";
        const by = (el.getAttribute("aria-labelledby") ?? "")
          .split(/\s+/)
          .map((id) => (id ? document.getElementById(id)?.innerText ?? "" : ""))
          .join(" ");
        return (fromLabels || aria || by || el.getAttribute("placeholder") || el.getAttribute("name") || "").replace(/\s+/g, " ").replace(/\*\s*$/, "").trim();
      };
      for (const el of Array.from(document.querySelectorAll("input, select, textarea")) as HTMLElement[]) {
        const input = el as HTMLInputElement;
        const type = el.tagName === "INPUT" ? (input.type || "text").toLowerCase() : el.tagName.toLowerCase();
        if (["hidden", "submit", "button", "reset", "image"].includes(type)) continue;
        const name = input.name || el.id;
        if (!name) continue;
        if (type === "radio") {
          if (seen.has(name)) {
            const group = out.find((f) => f.name === name);
            group?.options.push({ value: input.value, label: labelOf(el) });
            continue;
          }
          const fieldset = el.closest("fieldset");
          const legend = fieldset?.querySelector("legend")?.textContent?.replace(/\s+/g, " ").trim() ?? "";
          seen.add(name);
          out.push({ name, label: legend || name, type: "radio", required: input.required, options: [{ value: input.value, label: labelOf(el) }] });
          continue;
        }
        const options = el.tagName === "SELECT" ? Array.from((el as HTMLSelectElement).options).filter((o) => o.value).map((o) => ({ value: o.value, label: o.text.trim() })) : [];
        seen.add(name);
        out.push({ name, label: labelOf(el), type, required: input.required || el.getAttribute("aria-required") === "true", options });
      }
      return out;
    })
    .catch(() => [] as DomField[]);
}

function parseTarget(target: string | null): { role: string; name: string } | null {
  if (!target) return null;
  const m = /^([a-z]+)\s+"((?:[^"\\]|\\.)*)"$/.exec(target.trim());
  return m ? { role: m[1], name: m[2].replace(/\\"/g, '"') } : null;
}

function reasonOf(text: string): "captcha" | "login" | "payment" | "blocked" {
  if (/captcha|robot|human/i.test(text)) return "captcha";
  if (/sign in|log ?in|account|password/i.test(text)) return "login";
  if (/pay|card/i.test(text)) return "payment";
  return "blocked";
}

const CONSENT_RE = /\b(confirm|consent|agree|certify|acknowledge|attest)\b|同意|确认/i;

/**
 * The label of the group a radio/option/checkbox target belongs to (its radiogroup's name,
 * fieldset legend or the select's label): "Male" alone matches no rule, "Gender" does.
 */
async function groupLabelOf(page: PwPage, target: string): Promise<string | null> {
  const t = parseTarget(target);
  if (!t || !["radio", "option", "checkbox", "menuitemradio", "menuitemcheckbox"].includes(t.role)) return null;
  try {
    const loc = page.getByRole(t.role as Parameters<PwPage["getByRole"]>[0], { name: t.name, exact: true }).first();
    return await loc.evaluate((el) => {
      const text = (n: Element | null | undefined) => (n?.textContent ?? "").replace(/\s+/g, " ").trim();
      const group = el.closest("[role=radiogroup], [role=group], fieldset, select, [role=listbox]");
      if (!group) return null;
      const aria = group.getAttribute("aria-label");
      if (aria) return aria.trim();
      const by = group.getAttribute("aria-labelledby");
      if (by) return by.split(/\s+/).map((id) => text(document.getElementById(id))).join(" ").trim() || null;
      if (group.tagName === "FIELDSET") return text(group.querySelector("legend")) || null;
      if (group.tagName === "SELECT") return Array.from((group as HTMLSelectElement).labels ?? []).map((l) => text(l)).join(" ").trim() || null;
      return null;
    });
  } catch {
    return null;
  }
}

/** Runs the agent on one form. Never throws: every outcome is a BrowserRunResult. */
export async function runBrowserAgent(input: BrowserRunInput): Promise<BrowserRunResult> {
  const budget = input.deps?.timeBudgetMs ?? DEFAULT_BUDGET_MS;
  const deadline = Date.now() + budget;
  const store =
    input.deps?.storeScreenshot ??
    (async ({ userId, applicationId, n, png }: { userId: string; applicationId: string; n: number; png: Uint8Array }) => {
      const key = screenKey(userId, applicationId, n);
      await putObject(key, png, "image/png");
      return key;
    });
  let shotN = 0;
  let lastShot: string | undefined;
  const shoot = async (page: PwPage, fullPage = false) => {
    try {
      const png = await page.screenshot({ type: "png", fullPage, timeout: 10_000 });
      const key = await store({ userId: input.userId, applicationId: input.applicationId, n: ++shotN, png: new Uint8Array(png) });
      if (key) lastShot = key;
    } catch (err) {
      await captureError(err, { route: "channels.ch3.screenshot", severity: "warn", context: { applicationId: input.applicationId } });
    }
    return lastShot;
  };
  const onStep = input.deps?.onStep;
  if (!hostAllowed(input.url, input.allowedHost)) {
    return { status: "needs_you", reason: "blocked", note: `The application page isn't on ${input.allowedHost}, so the agent won't open it.` };
  }
  const allowed = input.deps?.requestGuard ?? createRequestGuard();
  if (!(await allowed(input.url))) {
    return { status: "needs_you", reason: "blocked", note: "The application address isn't a public website, so the agent won't open it." };
  }

  let browser: PwBrowser | null = null;
  try {
    browser = await launch();
  } catch (err) {
    await captureError(err, { route: "channels.ch3.launch", context: { applicationId: input.applicationId } });
    return { status: "needs_you", reason: "unsupported", note: "The browser agent couldn't start, so this one is yours to submit." };
  }
  const allowSubmit = !input.dryRun;
  // Hard budget: whatever is still running when it expires is cut off by closing the browser.
  const killer = setTimeout(() => void browser?.close().catch(() => undefined), budget + 10_000);
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: false, locale: "en-US", userAgent: undefined, javaScriptEnabled: true, serviceWorkers: "block" });
    // Every request (not only the page itself) passes the network guard: no private addresses,
    // no other schemes. On top of that, any top-level navigation off the apply host is refused.
    await context.route("**/*", async (route) => {
      const req = route.request();
      if (!(await allowed(req.url()))) {
        await route.abort("blockedbyclient");
        return;
      }
      let topLevel = false;
      try {
        topLevel = req.isNavigationRequest() && req.frame() === req.frame().page().mainFrame();
      } catch {
        topLevel = false; // service-worker requests have no frame
      }
      if (topLevel && !hostAllowed(req.url(), input.allowedHost)) {
        await route.abort("blockedbyclient");
        return;
      }
      await route.continue();
    });
    await context.routeWebSocket(/.*/, async (ws) => {
      if (await allowed(ws.url().replace(/^ws/i, "http"))) ws.connectToServer();
      else await ws.close({ code: 1008, reason: "blocked" });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    let res: Awaited<ReturnType<PwPage["goto"]>>;
    try {
      res = await page.goto(input.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (/ERR_BLOCKED_BY_CLIENT/.test(msg)) return { status: "needs_you", reason: "blocked", note: `The page redirected away from ${input.allowedHost}; we only act on the application site.` };
      if (/Timeout|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION/.test(msg)) return { status: "failed", error: "The application site didn't load. We'll try again shortly.", retryable: true };
      throw err;
    }
    if (!res || res.status() >= 400) {
      await shoot(page);
      return { status: "failed", error: `The application page answered ${res?.status() ?? "nothing"}.`, retryable: (res?.status() ?? 500) >= 500, screenshotKey: lastShot };
    }
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
    await shoot(page);
    const html0 = await page.content();
    const blockers = detectBlockers(html0);
    if (blockers.captcha) return { status: "needs_you", reason: "captcha", note: "The form has a CAPTCHA; only you can solve it.", screenshotKey: lastShot };

    // Field mapping by accessible label (local: deterministic synonyms; Claude when enabled).
    const person = await (input.deps?.loadPerson ?? loadPersonContext)(input.userId);
    const fields = await domFields(page);
    const docs = input.files.map((f) => ({ id: f.field, kind: /resume|cv|简历/i.test(f.field + f.filename) ? "resume" : /cover/i.test(f.field + f.filename) ? "cover_letter" : "other", filename: f.filename }));
    const mapping = await getIntelligence({ userId: input.userId }).mapFormFields({
      fields: fields.map((f) => ({ name: f.name, label: f.label, type: f.type, options: f.options, required: f.required })),
      profile: person.profile,
      facts: person.facts,
      answers: input.answers,
      documents: docs,
      language: person.language,
    });
    const values: Record<string, string> = {};
    const fileTargets: Record<string, string> = {};
    let filled = 0;
    for (const m of mapping) {
      const f = fields.find((x) => x.name === m.name);
      if (!f) continue;
      if (f.type === "file") {
        const loaded = input.files.find((x) => x.field === f.name || x.field === f.label) ?? (m.value ? input.files.find((x) => x.field === m.value) : undefined);
        if (loaded) fileTargets[f.label || f.name] = loaded.field;
        continue;
      }
      if (m.value !== null && m.value !== "") {
        const shown = f.options.find((o) => o.value === m.value)?.label ?? m.value;
        values[f.label || f.name] = f.type === "radio" ? shown : m.value;
        values[f.name] = values[f.label || f.name];
        filled++;
      }
    }

    // Consent boxes are the person's own: ticked only when they said yes in Onward Scout and only on the real submit.
    if (allowSubmit) {
      for (const f of fields) {
        if (f.type !== "checkbox" || !CONSENT_RE.test(f.label)) continue;
        if (!TRUE_RE.test((input.answers[f.name] ?? input.answers[f.label] ?? "").trim())) continue;
        await page.locator(`input[type=checkbox][name="${f.name.replace(/"/g, '\\"')}"]`).first().check({ timeout: 5_000 }).catch(() => undefined);
      }
    }

    const ai = getIntelligence({ userId: input.userId });
    const history: { action: string; target: string | null; value: string | null; ok: boolean; note: string | null }[] = [];
    for (let step = 0; step < MAX_STEPS; step++) {
      if (Date.now() > deadline) {
        await shoot(page);
        return { status: "failed", error: "The form took longer than two minutes to fill, so we stopped. Nothing was submitted after that point.", retryable: true, screenshotKey: lastShot };
      }
      const axTree = (await page.locator("body").ariaSnapshot({ timeout: 8_000 }).catch(() => "")).slice(0, AX_LIMIT);
      const summary = await pageSummary(page);
      const plan = await ai.planBrowserStep({
        goal: input.goal,
        pageSummary: summary,
        axTree,
        history,
        values,
        files: fileTargets,
        allowSubmit,
        allowedHost: input.allowedHost,
        currentUrl: page.url(),
      });
      // Rules, not the model, decide consent/EEO/signature/password/payment fields and what is typed.
      const group = plan.target ? await groupLabelOf(page, plan.target) : null;
      const guard = guardBrowserStep(plan, { values, answers: input.answers, groupLabel: group });
      if (!guard.ok) {
        await shoot(page, true);
        return { status: "needs_you", reason: "blocked", note: guard.reason, screenshotKey: lastShot };
      }
      if (plan.action === "stop") {
        const submitted = history.some((h) => h.ok && (h.action === "submit" || h.action === "click"));
        if (plan.needsUser) {
          await shoot(page, true);
          return { status: "needs_you", reason: reasonOf(plan.reason), note: plan.reason, screenshotKey: lastShot };
        }
        if (plan.done && submitted) {
          const reading = readResponse(await page.content());
          await shoot(page, true);
          return { status: "submitted", url: page.url(), confirmationText: reading.confirmationText ?? plan.reason, ...(reading.ref ? { ref: reading.ref } : {}), screenshotKey: lastShot };
        }
        await shoot(page, true);
        if (plan.done && !allowSubmit) return { status: "ready", url: page.url(), screenshotKey: lastShot, filled };
        return { status: "needs_you", reason: "blocked", note: plan.reason, screenshotKey: lastShot };
      }

      const t = parseTarget(plan.target);
      let ok = true;
      let note: string | null = null;
      try {
        const loc = t ? page.getByRole(t.role as Parameters<PwPage["getByRole"]>[0], { name: t.name, exact: true }).first() : null;
        switch (plan.action) {
          case "fill":
            if (!loc) throw new Error("no target");
            await loc.fill(plan.value ?? "");
            break;
          case "select":
            if (!loc) throw new Error("no target");
            await loc.selectOption(plan.value ?? "").catch(async () => loc.selectOption({ label: plan.value ?? "" }));
            break;
          case "check":
            if (!loc) throw new Error("no target");
            await loc.check();
            break;
          case "uncheck":
            if (!loc) throw new Error("no target");
            await loc.uncheck();
            break;
          case "upload": {
            const file = input.files.find((f) => f.field === plan.value) ?? input.files.find((f) => t && (f.field === t.name || f.filename === t.name));
            if (!file) throw new Error("no prepared file");
            const payload = { name: file.filename, mimeType: file.contentType, buffer: Buffer.from(file.bytes) };
            const byLabel = t ? page.getByLabel(t.name, { exact: true }).first() : null;
            const byName = page.locator(`input[type=file][name="${file.field.replace(/"/g, '\\"')}"]`).first();
            if (byLabel && (await byLabel.count()) > 0) await byLabel.setInputFiles(payload).catch(async () => byName.setInputFiles(payload));
            else await byName.setInputFiles(payload);
            break;
          }
          case "click":
          case "submit":
            if (!loc) throw new Error("no target");
            await Promise.all([page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => undefined), loc.click()]);
            await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
            break;
          case "scroll":
            await page.mouse.wheel(0, 600);
            break;
          case "wait":
            await page.waitForTimeout(800);
            break;
        }
      } catch (err) {
        ok = false;
        note = err instanceof Error ? err.message.slice(0, 200) : "action failed";
      }
      history.push({ action: plan.action, target: plan.target, value: plan.action === "upload" ? plan.value : plan.value ? "(prepared value)" : null, ok, note });
      const key = await shoot(page);
      onStep?.({ n: shotN, action: plan.action, target: plan.target, ok, note, screenshotKey: key ?? null });
      if (!hostAllowed(page.url(), input.allowedHost)) {
        return { status: "needs_you", reason: "blocked", note: `The page moved to ${hostOf(page.url()) ?? "another site"}; we only act on ${input.allowedHost}.`, screenshotKey: lastShot };
      }
    }
    await shoot(page, true);
    return { status: "needs_you", reason: "blocked", note: "The form needed more steps than we take automatically; the rest is yours.", screenshotKey: lastShot };
  } catch (err) {
    await captureError(err, { route: "channels.ch3.run", context: { applicationId: input.applicationId, host: input.allowedHost } });
    return { status: "failed", error: "The browser agent hit an error on this form. Nothing was submitted after it.", retryable: true, screenshotKey: lastShot };
  } finally {
    clearTimeout(killer);
    await browser.close().catch(() => undefined);
  }
}

/* ------------------------------------------------------------------ channel */

function toSubmitResult(run: BrowserRunResult, handoff: () => ReturnType<typeof buildHandoff>): SubmitResult {
  switch (run.status) {
    case "submitted":
      return { status: "submitted", evidence: { url: run.url, ...(run.confirmationText ? { confirmationText: run.confirmationText } : {}), ...(run.ref ? { ref: run.ref } : {}), ...(run.screenshotKey ? { screenshotKey: run.screenshotKey } : {}) } };
    case "ready":
      return {
        status: "submitted",
        evidence: {
          url: run.url,
          confirmationText: `Dry run — the form is filled (${run.filled} answers) and waiting for your confirmation. Nothing was submitted.`,
          ...(run.screenshotKey ? { screenshotKey: run.screenshotKey } : {}),
        },
      };
    case "needs_you": {
      const h = handoff();
      return { status: "needs_you", reason: run.reason, handoff: { ...h, notes: [run.note, ...h.notes] } };
    }
    case "failed":
      return { status: "failed", error: run.error, retryable: run.retryable };
  }
}

/** Shared by CH1/CH2 when they delegate to the browser. */
export async function submitWithBrowser(ctx: SubmitContext, url: string, req: Pick<Requirements, "fields" | "requiresAccount" | "requiresPayment" | "captchaLikely" | "notes" | "channel">, deps?: ChannelDeps, locale: Lang = "en"): Promise<SubmitResult> {
  const handoff = () => buildHandoff(ctx.opportunity, { ...req, submitUrl: url }, ctx.prepared.answers, ctx.prepared.files, locale);
  const host = hostOf(url);
  if (!host) return { status: "needs_you", reason: "unsupported", handoff: handoff() };
  const { loaded, missing } = await loadPreparedFiles(ctx.userId, ctx.prepared.files, deps?.loadFile ?? loadPreparedFile);
  if (missing.length) return { status: "failed", error: `These files couldn't be loaded: ${missing.join(", ")}.`, retryable: true };
  const run = await runBrowserAgent({
    userId: ctx.userId,
    applicationId: ctx.application.id,
    url,
    allowedHost: host,
    answers: ctx.prepared.answers,
    files: loaded,
    fields: req.fields,
    goal: `Fill the application form for ${ctx.opportunity.name}${ctx.opportunity.orgName ? ` (${ctx.opportunity.orgName})` : ""} with the prepared values.`,
    dryRun: ctx.dryRun,
    deps,
  });
  return toSubmitResult(run, handoff);
}

export const ch3Browser: Channel = {
  id: "CH3",
  analyze,
  async submit(ctx, deps) {
    const url = ctx.opportunity.apply.url ?? ctx.opportunity.url;
    const req = emptyRequirements(ctx.opportunity);
    const handoff = (reasonNote?: string) => {
      const h = buildHandoff(ctx.opportunity, req, ctx.prepared.answers, ctx.prepared.files);
      return reasonNote ? { ...h, notes: [reasonNote, ...h.notes] } : h;
    };
    if (!url) return { status: "needs_you", reason: "unsupported", handoff: handoff("There is no application link to open.") };
    const forbidden = forbiddenPlatform(url, ctx.opportunity.apply.platform);
    if (forbidden) return { status: "needs_you", reason: "blocked", handoff: handoff() };
    if (!browserAgentEnabled(deps)) {
      return { status: "needs_you", reason: "unsupported", handoff: handoff("Automatic form filling is switched off right now, so this one is yours to submit — everything is ready to copy.") };
    }
    return submitWithBrowser(ctx, url, req, deps);
  },
};
