import "server-only";
import { and, eq, inArray, ne } from "drizzle-orm";
import { hasCjk } from "@/lib/core/labels";
import type { DocumentExtraction, DocumentKind } from "@/lib/core/types";
import { db } from "@/lib/db";
import { documents, facts, jobs, type DocumentRow, type FactRow } from "@/lib/db/schema";
import { readObject } from "@/lib/files";
import { ExtractError, extractFile, type FileFormat } from "@/lib/ingest/extract";
import { ingestUrl } from "@/lib/ingest/url";
import type { JobModule } from "@/lib/jobs/handlers";
import { registerJob, type JobContext } from "@/lib/jobs/registry";
import { PermanentJobError, type JobResult } from "@/lib/jobs/state";
import { newId } from "@/lib/ids";
import { getIntelligence, type ExtractDocument } from "@/lib/llm";
import { getUserLocale } from "@/lib/user";
import { mergeProfile, planFactSync, type NewFact } from "./merge";
import { queueExtraction } from "./pipeline";
import { confirmedOf, getFacts, getProfile, setProfileStatus, writeProfile } from "./store";

/*
 * Profile jobs (contracts §10):
 *  - 'profile.parse'  {documentId}: file from R2 (or the link) → text, kind, extraction
 *    metadata; the last parse of a batch to finish queues the extraction.
 *  - 'profile.extract' {userId, locale}: every parsed source → intelligence.extractProfile →
 *    merged into the stored profile (confirmed values never overwritten), new version and
 *    snapshot, facts synced with their sources (dedupe by path + value), identity guesses
 *    kept as `/roles/<code>` facts with the reason, per-document counts for the live status.
 * Both are idempotent: running one twice changes nothing the second time.
 */

const METHOD: Partial<Record<FileFormat, DocumentExtraction["method"]>> = {
  pdf: "pdf_text",
  docx: "docx",
  pptx: "pptx",
  text: "text",
  html: "html",
  image: "image_llm",
};

/** Main language of a text, roughly: enough CJK characters → zh. */
function languageOf(text: string): string | null {
  const sample = text.slice(0, 4000);
  if (!sample.trim()) return null;
  const cjk = [...sample].filter((ch) => hasCjk(ch)).length;
  return cjk / Math.max(1, sample.replace(/\s/g, "").length) > 0.15 ? "zh" : "en";
}

async function ownerLocale(ownerId: string, fallback: unknown): Promise<"en" | "zh"> {
  if (fallback === "zh" || fallback === "en") return fallback;
  if (ownerId.startsWith("anon_")) return "en";
  return getUserLocale(ownerId);
}

/* ------------------------------------------------------------------ profile.parse */

async function parseDocumentJob(ctx: JobContext): Promise<JobResult> {
  const documentId = typeof ctx.payload.documentId === "string" ? ctx.payload.documentId : "";
  if (!documentId) throw new PermanentJobError("profile.parse needs a documentId");
  const doc = (await db.select().from(documents).where(eq(documents.id, documentId)).limit(1))[0];
  if (!doc) return { status: "done", result: { skipped: "deleted" } };
  await db.update(documents).set({ status: "parsing", error: null }).where(eq(documents.id, doc.id));

  const parsedAt = new Date().toISOString();
  let patch: Partial<Pick<DocumentRow, "status" | "error" | "extractedText" | "extraction" | "kind" | "filename">>;

  if (doc.objectKey) {
    const bytes = await readObject(doc.objectKey);
    if (!bytes) {
      patch = { status: "failed", error: "The file didn't arrive. Please drop it again." };
    } else {
      try {
        const f = await extractFile({ bytes, filename: doc.filename ?? "document", contentType: doc.contentType });
        const kind: DocumentKind = doc.kind === "other" && f.kindConfidence >= 0.4 ? f.kind : doc.kind;
        patch = {
          status: "parsed",
          kind,
          extractedText: f.text,
          extraction: {
            method: f.needsVision ? (f.format === "pdf" ? "pdf_llm" : "image_llm") : (METHOD[f.format] ?? null),
            language: languageOf(f.text),
            pages: f.pages ?? null,
            title: null,
            counts: {},
            links: [],
            meta: { parsedAt, format: f.format, ...(f.needsVision ? { needsVision: "1", mediaType: f.mediaType ?? "" } : {}) },
            warnings: f.warnings.slice(0, 5),
            truncated: f.truncated,
          },
        };
      } catch (err) {
        if (!(err instanceof ExtractError)) throw err; // unexpected: retried with backoff, then reported
        patch = { status: "failed", error: err.message };
      }
    }
  } else if (doc.sourceUrl) {
    const r = await ingestUrl(doc.sourceUrl, { signal: ctx.signal });
    if (r.status === "ok") {
      patch = {
        status: "parsed",
        extractedText: r.text,
        filename: (r.title?.trim() || doc.filename || r.finalUrl).slice(0, 120),
        extraction: {
          method: r.source === "github" ? "github" : r.source === "orcid" ? "orcid" : r.source === "document" ? "pdf_text" : "html",
          language: languageOf(r.text),
          pages: null,
          title: r.title,
          counts: {},
          links: r.links.slice(0, 20),
          meta: { parsedAt, source: r.source, finalUrl: r.finalUrl },
          warnings: r.warnings.slice(0, 5),
          truncated: false,
        },
      };
    } else if (r.status === "skipped") {
      // Kept as a link on the profile; the person is told how to import it instead.
      patch = {
        status: "parsed",
        extractedText: "",
        extraction: { method: null, language: null, pages: null, title: null, counts: {}, links: [], meta: { parsedAt, skipped: r.reason }, warnings: [r.hint.en], truncated: false },
      };
    } else {
      patch = { status: "failed", error: r.error, extraction: { method: null, language: null, pages: null, title: null, counts: {}, links: [], meta: { parsedAt, code: r.code }, warnings: [], truncated: false } };
    }
  } else {
    // A note: its text is the source; nothing to read.
    patch = { status: "parsed" };
  }

  const updated = await db.update(documents).set(patch).where(eq(documents.id, doc.id)).returning({ id: documents.id });
  if (!updated[0]) return { status: "done", result: { skipped: "deleted" } };

  // The last parse of a batch to finish starts the extraction (any parse that sees no other
  // pending document queues it; extractions of the same source set are deduplicated).
  const pending = await db
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.userId, doc.userId), inArray(documents.status, ["uploaded", "parsing"])))
    .limit(1);
  if (!pending.length) await queueExtraction(doc.userId, { locale: await ownerLocale(doc.userId, ctx.payload.locale) });
  return { status: "done", result: { status: patch.status ?? doc.status } };
}

/* ------------------------------------------------------------------ profile.extract */

const SECTION_OF: Record<string, string> = {
  experience: "experience",
  education: "education",
  projects: "projects",
  publications: "publications",
  skills: "skills",
  achievements: "achievements",
  certifications: "certifications",
};

/** Which profile section a fact path counts toward ("found 3 roles, 2 projects…"). */
export function sectionOfPath(path: string): string | null {
  const segs = path.split("/").filter(Boolean);
  if (segs[0] === "packs" && segs[1] === "founder" && segs[2] === "ventures" && segs.length === 4) return "ventures";
  return segs.length === 2 ? (SECTION_OF[segs[0]!] ?? null) : null;
}

/** The source a reason most likely came from: the document whose text mentions it. */
function docForReason(why: string, docs: readonly Pick<DocumentRow, "id" | "extractedText">[]): string | null {
  const words = why
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 4)
    .slice(0, 8);
  let best: { id: string; hits: number } | null = null;
  for (const d of docs) {
    const text = (d.extractedText ?? "").toLowerCase();
    if (!text) continue;
    const hits = words.filter((w) => text.includes(w.toLowerCase())).length;
    if (!best || hits > best.hits) best = { id: d.id, hits };
  }
  return best?.id ?? null;
}

const MAX_VISION_BYTES = 4 * 1024 * 1024;

async function extractProfileJob(ctx: JobContext): Promise<JobResult> {
  const ownerId = typeof ctx.payload.userId === "string" ? ctx.payload.userId : (ctx.userId ?? "");
  if (!ownerId) throw new PermanentJobError("profile.extract needs a userId");
  // One extraction per person at a time: wait for the one already running.
  const running = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.kind, "profile.extract"), eq(jobs.userId, ownerId), eq(jobs.status, "running"), ne(jobs.id, ctx.job.id)))
    .limit(1);
  if (running.length) return { status: "continue", delayMs: 4000 };

  const locale = await ownerLocale(ownerId, ctx.payload.locale);
  const before = await getProfile(ownerId);
  await setProfileStatus(ownerId, "parsing");
  try {
    const docs = await db.select().from(documents).where(eq(documents.userId, ownerId));
    const parsed = docs.filter((d) => d.status === "parsed" && !d.extraction?.meta?.skipped);
    // Anonymous drafts are budgeted under their own id (a small per-draft and a global daily
    // allowance, see llm/index.ts); a draft past its daily extraction count runs locally.
    const ai = getIntelligence({ userId: ownerId, ...(ctx.payload.local === true ? { provider: "local" as const } : {}) });
    const input: ExtractDocument[] = [];
    for (const d of parsed) {
      const item: ExtractDocument = { id: d.id, kind: d.kind, filename: d.filename ?? "document", text: d.extractedText ?? "", sourceUrl: d.sourceUrl };
      if (d.extraction?.meta?.needsVision && ai.provider === "anthropic" && d.objectKey && d.bytes <= MAX_VISION_BYTES) {
        const bytes = await readObject(d.objectKey);
        if (bytes) {
          item.imageBase64 = Buffer.from(bytes).toString("base64");
          item.mediaType = d.extraction.meta.mediaType || d.contentType || undefined;
        }
      }
      input.push(item);
    }
    const links = docs.filter((d) => d.kind === "link" && d.sourceUrl).map((d) => ({ url: d.sourceUrl!, label: null }));
    const out = await ai.extractProfile({ documents: input, links, locale });

    // The person's confirmed facts are read inside the write, so a tap that lands while the
    // extraction runs is never overwritten by it.
    const saved = await writeProfile(ownerId, async (current) => ({ profile: mergeProfile(current, out.profile, { confirmed: confirmedOf(await getFacts(ownerId)) }), status: "draft", bump: true }));
    const existing = await getFacts(ownerId);

    const incoming: NewFact[] = [
      ...out.facts.map((f) => ({ path: f.path, claim: f.claim.slice(0, 500), value: f.value ?? null, sourceDocId: f.sourceDocId, quote: f.quote ? f.quote.slice(0, 300) : null, confidence: f.confidence })),
      // Identity guesses: why we pre-selected each identity (shown as the hint on its chip).
      ...out.identities.map((g) => ({ path: `/roles/${g.code}`, claim: g.why.slice(0, 300), value: { code: g.code, confidence: g.confidence, stage: g.stage }, sourceDocId: docForReason(g.why, parsed), quote: null, confidence: g.confidence })),
    ];
    const plan = planFactSync(
      existing.map((f) => ({ id: f.id, path: f.path, claim: f.claim, value: f.value, sourceDocId: f.sourceDocId, quote: f.quote, confidence: f.confidence, confirmedByUser: f.confirmedByUser })),
      incoming,
    );
    for (let i = 0; i < plan.remove.length; i += 200) await db.delete(facts).where(and(eq(facts.userId, ownerId), inArray(facts.id, plan.remove.slice(i, i + 200))));
    for (const u of plan.update) {
      await db.update(facts).set({ claim: u.claim, quote: u.quote, confidence: u.confidence, sourceDocId: u.sourceDocId, profileId: saved.id }).where(and(eq(facts.id, u.id), eq(facts.userId, ownerId), eq(facts.confirmedByUser, false)));
    }
    for (let i = 0; i < plan.insert.length; i += 100) {
      const chunk = plan.insert.slice(i, i + 100);
      await db.insert(facts).values(
        chunk.map((f) => ({
          id: newId("fct"),
          userId: ownerId,
          profileId: saved.id,
          path: f.path,
          claim: f.claim,
          value: (f.value ?? null) as FactRow["value"],
          sourceDocId: f.sourceDocId,
          quote: f.quote,
          confidence: f.confidence,
          confirmedByUser: false,
        })),
      );
    }

    // Per-document counts for "Reading your CV… found 3 roles, 2 projects, 1 paper".
    const extractedAt = new Date().toISOString();
    for (const d of parsed) {
      const counts: Record<string, number> = {};
      for (const f of out.facts) {
        if (f.sourceDocId !== d.id) continue;
        const s = sectionOfPath(f.path);
        if (s) counts[s] = (counts[s] ?? 0) + 1;
      }
      const base: DocumentExtraction = d.extraction ?? { method: null, language: null, pages: null, title: null, counts: {}, links: [], meta: {}, warnings: [], truncated: false };
      await db
        .update(documents)
        .set({ extraction: { ...base, counts, meta: { ...base.meta, extractedAt } } })
        .where(eq(documents.id, d.id));
    }
    return { status: "done", result: { version: saved.version, facts: incoming.length, inserted: plan.insert.length, removed: plan.remove.length } };
  } catch (err) {
    // Never leave the profile stuck in "parsing": the next attempt sets it again.
    await setProfileStatus(ownerId, before?.status === "parsing" || !before ? "draft" : before.status, ["parsing"]);
    throw err;
  }
}

export const jobHandlers: JobModule = {
  "profile.parse": { handler: parseDocumentJob, leaseMs: 3 * 60_000, maxAttempts: 4 },
  "profile.extract": { handler: extractProfileJob, leaseMs: 4 * 60_000, maxAttempts: 4 },
};

// Registered on import as well, so the inline kick right after an upload finds the handler
// in this process even before src/lib/jobs/handlers.ts lists the module.
for (const [kind, entry] of Object.entries(jobHandlers)) {
  if (!entry) continue;
  if (typeof entry === "function") registerJob(kind, entry);
  else registerJob(kind, entry.handler, entry);
}
