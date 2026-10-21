import "server-only";

/*
 * Sources & seed data (P2b): where opportunities come from.
 * - ATS boards (Greenhouse / Lever / Ashby public posting APIs) → jobs (private, app-only);
 * - curated programs (content/seed/curated/*.json, hand-verified) → public program pages;
 * - the built-in practice opportunity (sandbox form).
 * Consumers (admin, cron, jobs) import from here; pure helpers live in their own modules.
 */
export { runSources, runBoard, syncBoardSources, dueBoards, maxJobsPerBoard, type RunOptions, type RunReport, type BoardOutcome, type RunScope } from "./runner";
export { seedCurated, seedPractice, loadBoards, type CuratedSeedReport } from "./seed";
export { reverifyPrograms, checkPage, type PageCheck, type VerifyReport } from "./crawl";
export { expirePastDeadlines, isPastDeadline } from "./expiry";
export { PRACTICE_SLUG, PRACTICE_FORM_URL } from "./practice";
export type { MappedOpportunity, BoardRef, OpportunityDraft } from "./types";
