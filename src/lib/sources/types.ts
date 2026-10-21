/*
 * Shared shapes of the sources layer (P2b). Everything that ingests opportunities — the ATS
 * clients, the curated seed loader, the practice opportunity — produces `MappedOpportunity`
 * values; the store writes them idempotently (by slug, or by (source_id, source_ref)).
 */
import type { AtsProvider, OpportunitySnapshotRaw, OpportunityTypeId } from "@/lib/core/types";
import type { NewOpportunityRow } from "@/lib/db/schema";

/** An `opportunities` row without the columns the store owns (id, timestamps, generated search). */
export type OpportunityDraft = Omit<NewOpportunityRow, "id" | "createdAt" | "updatedAt" | "sourceId"> & {
  type: OpportunityTypeId;
  slug: string;
  name: string;
};

export interface MappedOpportunity {
  draft: OpportunityDraft;
  /** Stable id inside its source: the ATS posting id, or the curated slug. */
  sourceRef: string;
  /** Hash of everything we store about it; an unchanged hash means nothing to write. */
  hash: string;
  /** What was read, kept in `opportunity_snapshots` for change detection (never shown verbatim). */
  raw: OpportunitySnapshotRaw;
}

/** One ATS board from content/seed/ats-boards.json (and `sources.config`). */
export interface BoardRef {
  provider: AtsProvider;
  token: string;
  company: string;
  /** Free-text industries from the research team ("fintech", "ai"). */
  industries: string[];
  /** Headquarters country (ISO) — context only, never used as a job location. */
  hq: string | null;
  jobCount?: number;
}

/** What a board mapping needs to know about the board. */
export interface BoardContext {
  provider: AtsProvider;
  token: string;
  company: string;
  orgSlug: string;
  /** Industry codes (core/industries.ts) mapped from the board's free-text industries. */
  industries: string[];
}

/** Job types an ATS posting can become. */
export type JobType = Extract<OpportunityTypeId, "job" | "internship" | "remote_job" | "part_time">;

/** Provider-neutral posting, filled by each ATS client and mapped by `buildJob`. */
export interface JobInput {
  provider: AtsProvider;
  postingId: string;
  title: string;
  /** Hosted posting page (what a person opens). */
  url: string;
  /** Hosted application form, when the provider has a separate one. */
  applyUrl: string | null;
  /** Description as HTML (preferred) or plain text. */
  html: string | null;
  text: string | null;
  departments: string[];
  /** "FullTime", "Full Time", "Intern", "Part-time", "Contract"… as the provider says it. */
  employmentType: string | null;
  /** Free-text locations as the provider lists them (primary first). */
  locations: string[];
  /** Explicit country codes or names from structured fields. */
  countryHints: string[];
  /** Provider's workplace type ("remote", "Hybrid", "OnSite"…). */
  workplaceType: string | null;
  /** Language code the provider declares (Greenhouse `language`). */
  language: string | null;
  salary: { min: number | null; max: number | null; currency: string | null; period: "year" | "month" | "week" | "day" | "hour" | null; text: string | null } | null;
  deadline: string | null;
  publishedAt: string | null;
  updatedAt: string | null;
}

export interface CuratedInvalid {
  file: string;
  index: number;
  slug: string | null;
  issues: string[];
}

export interface CuratedWarning {
  file: string;
  slug: string;
  message: string;
}
