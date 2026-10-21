import type { JobModule } from "@/lib/jobs/handlers";
import { followUpJob } from "./followup";
import { prepareJob } from "./prepare";
import { submitJob } from "./submit";

/*
 * Job handlers for the application engine (contracts §10). The integrator enables the three
 * lines in src/lib/jobs/handlers.ts (JOB_MODULES).
 */
export const jobHandlers: JobModule = {
  "application.prepare": { handler: prepareJob, leaseMs: 4 * 60_000 },
  // A browser submission (CH3) can take minutes; the lease covers it.
  "application.submit": { handler: submitJob, leaseMs: 6 * 60_000, maxAttempts: 3 },
  "application.followup": { handler: followUpJob, leaseMs: 3 * 60_000 },
};
