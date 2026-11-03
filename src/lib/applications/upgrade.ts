import "server-only";
import type { JobContext } from "@/lib/jobs/registry";
import type { JobResult } from "@/lib/jobs/state";
import { hasPendingWork, queueExtraction } from "@/lib/profile/pipeline";
import { getUserLocale } from "@/lib/user";
import { enqueuePrepare, loadApplication, transition } from "./engine";
import { isUnlocked } from "./unlock";

/*
 * Job `application.upgrade`: the full run an unlock pays for. The preview was drafted by the local
 * engine from a locally parsed profile; now (1) the profile is read again from every document
 * with Claude (`profile.extract` carrying this application id, which is what entitles the call),
 * then (2) the application is prepared again with `recompose`, so every document and every
 * drafted answer is written with Claude for this posting. The local versions stay as version 1
 * in the room's history. Re-runnable: each stage checks what is already done.
 */

/** How long the upgrade waits for the profile read before writing from what there is. */
const EXTRACT_WAIT_MS = 4 * 60_000;

export async function upgradeJob(job: JobContext): Promise<JobResult> {
  const applicationId = String(job.payload.applicationId ?? "");
  const app = await loadApplication(applicationId);
  if (!app) return { status: "done", result: { skipped: "missing" } };
  if (!isUnlocked(app) || app.practice) return { status: "done", result: { skipped: app.practice ? "practice" : "locked" } };
  if (app.submittedAt) return { status: "done", result: { skipped: "submitted" } };

  const state = (job.state ?? {}) as { extractQueuedAt?: number; extracted?: boolean };

  // 1. The profile, read again with Claude (the one read a paid application gets for free).
  if (!state.extractQueuedAt) {
    const locale = (await getUserLocale(app.userId).catch(() => "en")) === "zh" ? "zh" : "en";
    await queueExtraction(app.userId, { locale, force: true, applicationId: app.id });
    return { status: "continue", delayMs: 3000, state: { extractQueuedAt: Date.now() } };
  }
  if (!state.extracted) {
    const pending = await hasPendingWork(app.userId);
    if ((pending.parse || pending.extract) && Date.now() - state.extractQueuedAt < EXTRACT_WAIT_MS) return { status: "continue", delayMs: 3000, state };
  }

  // 2. Every document and answer, written again for this posting with Claude.
  const fresh = (await loadApplication(applicationId)) ?? app;
  if (fresh.status === "ready") {
    const next = await transition(fresh, "preparing", "system");
    await enqueuePrepare(next, { recompose: true });
  } else if (["draft", "needs_info", "preparing"].includes(fresh.status)) {
    await enqueuePrepare(fresh, { recompose: true });
  }
  return { status: "done", result: { status: fresh.status, recompose: true } };
}
