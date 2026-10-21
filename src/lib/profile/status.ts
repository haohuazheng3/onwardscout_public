import "server-only";
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { documents, facts, profiles } from "@/lib/db/schema";
import { captureError } from "@/lib/errors";
import { hasPendingWork, queueExtraction, queueParse } from "./pipeline";

/*
 * What the wizard polls every 1.5 s while sources are read: each document's state, the
 * profile's state, the counts found so far, and the newest facts (they appear as chips).
 * It also heals a stalled pipeline: a document still "uploaded" with no job behind it is
 * queued again, and a finished batch that was never extracted gets its extraction.
 */

export type DraftPhase = "empty" | "reading" | "building" | "ready";

export interface DraftStatus {
  phase: DraftPhase;
  profile: { status: string; version: number; completeness: number; counts: Record<string, number> } | null;
  documents: {
    id: string;
    kind: string;
    filename: string | null;
    sourceUrl: string | null;
    status: string;
    /** Where it came from: an uploaded file, a pasted link, or the person's note. */
    source: "file" | "link" | "note";
    error: string | null;
    warnings: string[];
    skipped: string | null;
    counts: Record<string, number>;
  }[];
  facts: { id: string; path: string; claim: string }[];
}

const STALL_SECONDS = 45;

export async function draftStatus(ownerId: string, opts: { locale?: "en" | "zh"; heal?: boolean } = {}): Promise<DraftStatus> {
  const [profileRows, docRows, factRows] = await Promise.all([
    db
      .select({
        status: profiles.status,
        version: profiles.version,
        completeness: profiles.completeness,
        experience: sql<number>`jsonb_array_length(${profiles.experience})`,
        education: sql<number>`jsonb_array_length(${profiles.education})`,
        projects: sql<number>`jsonb_array_length(${profiles.projects})`,
        publications: sql<number>`jsonb_array_length(${profiles.publications})`,
        skills: sql<number>`jsonb_array_length(${profiles.skills})`,
        achievements: sql<number>`jsonb_array_length(${profiles.achievements})`,
        certifications: sql<number>`jsonb_array_length(${profiles.certifications})`,
        ventures: sql<number>`coalesce(jsonb_array_length(${profiles.packs}->'founder'->'ventures'), 0)`,
      })
      .from(profiles)
      .where(eq(profiles.userId, ownerId))
      .limit(1),
    db
      .select({
        id: documents.id,
        kind: documents.kind,
        filename: documents.filename,
        sourceUrl: documents.sourceUrl,
        status: documents.status,
        error: documents.error,
        extraction: documents.extraction,
        hasFile: sql<boolean>`${documents.objectKey} is not null`,
        createdAt: documents.createdAt,
      })
      .from(documents)
      .where(eq(documents.userId, ownerId))
      .orderBy(desc(documents.createdAt))
      .limit(40),
    db
      .select({ id: facts.id, path: facts.path, claim: facts.claim })
      .from(facts)
      .where(and(eq(facts.userId, ownerId), sql`${facts.path} not like '/roles/%'`, sql`${facts.path} not like '/identity/links/%'`))
      .orderBy(desc(facts.createdAt))
      .limit(14),
  ]);
  const p = profileRows[0];
  const pendingDocs = docRows.filter((d) => d.status === "uploaded" || d.status === "parsing");
  // Read but not yet in the profile (the extraction is queued or about to be).
  const needsExtraction = docRows.some((d) => d.status === "parsed" && !d.extraction?.meta?.skipped && !(d.extraction?.meta?.extractedAt && d.extraction.meta.extractedAt >= (d.extraction.meta.parsedAt ?? "")));
  const building = p?.status === "parsing" || needsExtraction;

  if (opts.heal) {
    try {
      const work = await hasPendingWork(ownerId);
      if (!work.parse) {
        const stalled = await db
          .select({ id: documents.id })
          .from(documents)
          .where(and(eq(documents.userId, ownerId), inArray(documents.status, ["uploaded", "parsing"]), lt(documents.createdAt, sql`now() - make_interval(secs => ${STALL_SECONDS})`)))
          .limit(5);
        for (const d of stalled) await queueParse(ownerId, d.id, { again: true, locale: opts.locale });
      }
      if (!pendingDocs.length && !work.extract && needsExtraction) await queueExtraction(ownerId, { locale: opts.locale });
    } catch (err) {
      await captureError(err, { route: "profile/status (heal)", severity: "warn", context: { ownerId } });
    }
  }

  const phase: DraftPhase = !docRows.length && !p?.version ? "empty" : pendingDocs.length ? "reading" : building ? "building" : docRows.length || (p && p.status !== "empty") ? "ready" : "empty";
  return {
    phase,
    profile: p
      ? {
          status: p.status,
          version: p.version,
          completeness: p.completeness,
          counts: {
            experience: Number(p.experience),
            education: Number(p.education),
            projects: Number(p.projects),
            publications: Number(p.publications),
            skills: Number(p.skills),
            achievements: Number(p.achievements),
            certifications: Number(p.certifications),
            ventures: Number(p.ventures),
          },
        }
      : null,
    documents: docRows.map((d) => ({
      id: d.id,
      kind: d.kind,
      filename: d.filename,
      sourceUrl: d.sourceUrl,
      status: d.status,
      source: d.hasFile ? ("file" as const) : d.sourceUrl ? ("link" as const) : ("note" as const),
      error: d.error,
      warnings: d.extraction?.warnings ?? [],
      skipped: d.extraction?.meta?.skipped ?? null,
      counts: d.extraction?.counts ?? {},
    })),
    facts: factRows,
  };
}
