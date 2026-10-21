import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { opportunities, opportunitySnapshots, sources } from "@/lib/db/schema";
import { captureError } from "@/lib/errors";
import { newId, randomString, sha256 } from "@/lib/ids";
import { extractFile, ExtractError } from "@/lib/ingest/extract";
import { htmlToReadable } from "@/lib/ingest/html";
import { SafeFetchError, classifyLink, decodeBody, normalizeUserUrl, safeFetch } from "@/lib/ingest/url";
import { getIntelligence } from "@/lib/llm";
import { recordEvent } from "@/lib/notifications";
import { activeGoals } from "@/lib/profile";
import type { OpportunityTypeId } from "@/lib/core/types";
import { scoreAndPin } from "./matching";
import { canonicalOpportunityUrl, hostName, rowFromNormalized, slugify } from "./normalize";
import { cardFromRow, findVisibleByUrl, getMatchFor, getOpportunityRow, ownerRefPrefix } from "./queries";
import { goalPlanTypes } from "./ranking";
import type { MatchInfo, OpportunityCard } from "./types";

/*
 * "Add an opportunity you found" (plan §10.2 L4): a person pastes a link; we read the page
 * (SSRF-safe fetch), normalise it with the intelligence layer and keep it as a PRIVATE
 * opportunity — public = false, status "unverified", source kind "user", owner in source_ref
 * ("user:<userId>:<sha of the canonical URL>") — visible only to them, pinned on top of their
 * board. The same link twice refreshes the same record; a link that is already in the shared
 * catalog just pins the existing opportunity.
 */

export const USER_SOURCE_URL = "onwardscout://user-links";

export type ImportResult =
  | { ok: true; created: boolean; opportunity: OpportunityCard; match: MatchInfo | null; missing: string[]; typeGuessed: boolean }
  | { ok: false; status: 400 | 404 | 422 | 502; error: string };

let userSourceId: string | null = null;

/** The one `sources` row (kind "user") every pasted link belongs to. Disabled: never crawled. */
async function ensureUserSource(): Promise<string> {
  if (userSourceId) return userSourceId;
  await db
    .insert(sources)
    .values({
      id: newId("src"),
      kind: "user",
      name: "Links people added",
      url: USER_SOURCE_URL,
      config: { public: false, notes: "Opportunities people paste on the Scout board. Private to each person until reviewed." },
      schedule: "monthly",
      enabled: false,
    })
    .onConflictDoNothing({ target: [sources.kind, sources.url] });
  const rows = await db.select({ id: sources.id }).from(sources).where(and(eq(sources.kind, "user"), eq(sources.url, USER_SOURCE_URL))).limit(1);
  if (!rows[0]) throw new Error("The user-links source could not be created");
  return (userSourceId = rows[0].id);
}

/** source_ref of one person's link: owner + a hash of the canonical URL. */
export function userSourceRef(userId: string, canonicalUrl: string): string {
  return `${ownerRefPrefix(userId)}${sha256(canonicalUrl).slice(0, 24)}`;
}

const NOT_AN_OPPORTUNITY: Partial<Record<ReturnType<typeof classifyLink>, string>> = {
  linkedin: "LinkedIn pages need a login, so we can't read them. Paste the organiser's own page for the same opportunity — most LinkedIn posts link to it.",
  scholar: "That's a Google Scholar page, not an opportunity. Paste the page of the call, job or program itself.",
  orcid: "That's an ORCID profile, not an opportunity. Paste the page of the call, job or program itself.",
  github: "That's a GitHub page. Paste the page of the job, program or competition itself.",
};

interface PageRead {
  finalUrl: string;
  status: number;
  contentType: string;
  title: string | null;
  html?: string;
  text: string;
}

async function readPage(url: string): Promise<PageRead | { error: string; status: 404 | 422 | 502 }> {
  try {
    const res = await safeFetch(url, { headers: { accept: "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.5" } });
    if (res.status === 401 || res.status === 403) return { status: 422, error: "That page needs a login or blocks automated visits. Paste the organiser's public page for the same opportunity." };
    if (res.status === 404 || res.status === 410) return { status: 404, error: "That page doesn't exist (404). Check the link and try again." };
    if (res.status >= 400) return { status: 502, error: `That website answered with an error (${res.status}). Try again later.` };
    const ct = res.contentType.toLowerCase();
    if (ct.includes("application/pdf") || ct.includes("officedocument") || /\.(pdf|docx)(\?|$)/i.test(res.url)) {
      const filename = decodeURIComponent(new URL(res.url).pathname.split("/").pop() || "document.pdf");
      const doc = await extractFile({ bytes: new Uint8Array(res.body), filename, contentType: ct });
      if (doc.text.trim().length < 40) return { status: 422, error: "That document has no readable text. Paste the web page of the opportunity instead." };
      return { finalUrl: res.url, status: res.status, contentType: ct, title: filename, text: doc.text };
    }
    if (ct.includes("json") || ct.startsWith("text/plain")) {
      return { finalUrl: res.url, status: res.status, contentType: ct, title: null, text: decodeBody(res).slice(0, 100_000) };
    }
    if (ct && !ct.includes("html") && !ct.includes("xml")) return { status: 422, error: "That link isn't a web page or a document we can read." };
    const html = decodeBody(res);
    const page = htmlToReadable(html, res.url);
    if ((page.text ?? "").trim().length < 40 && !page.jsonLd.length) {
      return { status: 422, error: "That page has no readable text — it may need JavaScript or a login. Try the organiser's plain page for the same opportunity." };
    }
    return { finalUrl: res.url, status: res.status, contentType: ct, title: page.title, html, text: page.text };
  } catch (err) {
    if (err instanceof SafeFetchError) return { status: 422, error: err.message };
    if (err instanceof ExtractError) return { status: 422, error: err.message };
    throw err;
  }
}

/** Imports one link for one person. Never throws for page problems: they come back as `{ ok: false, error }`. */
export async function importFromUrl(userId: string, rawUrl: string): Promise<ImportResult> {
  const normalized = normalizeUserUrl(rawUrl);
  const canonical = normalized ? canonicalOpportunityUrl(normalized) : null;
  if (!normalized || !canonical) return { ok: false, status: 400, error: "That doesn't look like a web address. Paste the full link, starting with https://." };
  const notOpp = NOT_AN_OPPORTUNITY[classifyLink(canonical)];
  if (notOpp) return { ok: false, status: 422, error: notOpp };

  /* already in the catalog (or already added by this person) → pin it */
  const clean = canonicalOpportunityUrl(normalized, { keepWww: true }) ?? canonical;
  const existing = await findVisibleByUrl(userId, [canonical, clean, normalized, normalized.replace(/\/$/, "")]);
  if (existing) {
    await pinQuietly(userId, existing.id);
    return { ok: true, created: false, opportunity: cardFromRow(existing, userId), match: await getMatchFor(userId, existing.id), missing: [], typeGuessed: false };
  }

  const page = await readPage(canonical);
  if ("error" in page) return { ok: false, status: page.status, error: page.error };

  const read = await getIntelligence({ userId }).normalizeOpportunity({ url: page.finalUrl, html: page.html, text: page.html ? undefined : page.text });
  if (read.expired) {
    return {
      ok: false,
      status: 422,
      error: read.deadline
        ? `That page says applications closed on ${read.deadline}, so we didn't add it.`
        : "That page says applications are closed, so we didn't add it.",
    };
  }

  const goals = await activeGoals(userId);
  const fallbackType: OpportunityTypeId = goals.map((g) => goalPlanTypes({ family: g.family, sub: g.sub, constraints: g.constraints })[0]).find(Boolean) ?? "job";
  const stored = canonicalOpportunityUrl(page.finalUrl, { keepWww: true }) ?? clean;
  const row = rowFromNormalized(read, { url: stored, fallbackType, fallbackName: page.title?.trim() || `Opportunity on ${hostName(canonical)}` });

  const sourceId = await ensureUserSource();
  const sourceRef = userSourceRef(userId, canonical);
  const id = newId("opp");
  const content = {
    type: row.type,
    name: row.name,
    orgName: row.orgName,
    orgSlug: row.orgSlug,
    url: row.url,
    summary: row.summary,
    description: row.description,
    benefits: row.benefits,
    cost: row.cost,
    geo: row.geo,
    languages: row.languages,
    tags: row.tags,
    industries: row.industries,
    functions: row.functions,
    eligibility: row.eligibility,
    deadline: row.deadline,
    rolling: row.rolling,
    cycle: row.cycle,
    apply: row.apply,
    requiredMaterials: row.requiredMaterials,
    estEffortMinutes: row.estEffortMinutes,
  };
  const inserted = await db
    .insert(opportunities)
    .values({ id, slug: `${slugify(row.name) || "opportunity"}-${randomString(6)}`, ...content, sourceId, sourceRef, status: "unverified", public: false })
    .onConflictDoUpdate({
      target: [opportunities.sourceId, opportunities.sourceRef],
      set: { ...content, status: "unverified", public: false, updatedAt: sql`now()` },
    })
    .returning({ id: opportunities.id });
  const oppId = inserted[0]?.id ?? id;
  const created = oppId === id;

  try {
    const text = page.text.slice(0, 20_000);
    await db
      .insert(opportunitySnapshots)
      .values({
        id: newId("snp"),
        opportunityId: oppId,
        raw: { url: page.finalUrl, httpStatus: page.status, contentType: page.contentType, title: page.title, text, data: null },
        hash: sha256(`${page.finalUrl}\n${text}`),
      })
      .onConflictDoNothing();
  } catch (err) {
    await captureError(err, { route: "opportunities/import (snapshot)", severity: "warn", context: { opportunityId: oppId } });
  }

  await pinQuietly(userId, oppId);
  try {
    await recordEvent({ userId, kind: "opportunity_imported", opportunityId: oppId, data: { created, host: hostName(canonical), typeGuessed: row.typeGuessed } });
  } catch (err) {
    await captureError(err, { route: "opportunities/import (event)", severity: "warn" });
  }

  const fresh = await getOpportunityRow(oppId);
  if (!fresh) throw new Error(`Imported opportunity ${oppId} vanished`);
  return { ok: true, created, opportunity: cardFromRow(fresh, userId), match: await getMatchFor(userId, oppId), missing: row.missing, typeGuessed: row.typeGuessed };
}

/** Scores and pins; a scoring failure must not lose the person's link (it shows without a fit). */
async function pinQuietly(userId: string, opportunityId: string): Promise<void> {
  try {
    await scoreAndPin(userId, opportunityId);
  } catch (err) {
    await captureError(err, { route: "opportunities/import (score)", severity: "warn", context: { opportunityId } });
  }
}
