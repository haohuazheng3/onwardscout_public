import "server-only";
import { rateLimit, tooMany } from "@/lib/ratelimit";
import { anonWriteLimit, resolveDraftOwner, type DraftOwner } from "./anon";
import { ok } from "./http";
import { UPLOAD_LIMITS } from "./uploads";

/*
 * Owner + limits for the /api/drafts/* routes (contracts §8): the signed-in person when there
 * is a session (their normal limits), else the anonymous draft from the `os_anon` cookie —
 * created on the first write — with the signed-out limits: 10 files of ≤ 20 MB, 10 links,
 * per-IP request caps, 3 new drafts per IP per day.
 */

export interface DraftContext {
  owner: DraftOwner;
  maxFiles: number;
  maxLinks: number;
}

/** For writes: creates the anonymous draft when needed. `scope` names the per-IP limit. */
export async function draftWriter(scope: string, perIp: number, windowSeconds = 3600): Promise<DraftContext | Response> {
  const owner = await resolveDraftOwner({ create: true });
  if (owner === null) return Response.json({ error: "Please sign in to continue." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  if (owner instanceof Response) return owner;
  if (owner.anonymous) {
    const limited = await anonWriteLimit(scope, perIp, windowSeconds);
    if (limited) return limited;
    return { owner, maxFiles: UPLOAD_LIMITS.maxFiles, maxLinks: UPLOAD_LIMITS.maxLinks };
  }
  const rl = await rateLimit(`drafts:${scope}:${owner.ownerId}`, perIp * 2, windowSeconds);
  if (!rl.ok) return tooMany(rl);
  return { owner, maxFiles: UPLOAD_LIMITS.maxFilesSignedIn, maxLinks: UPLOAD_LIMITS.maxLinks * 3 };
}

/** For reads: null when the visitor has no draft yet. */
export async function draftReader(): Promise<DraftOwner | null | Response> {
  return resolveDraftOwner({ create: false });
}

export const EMPTY_STATUS = { phase: "empty", profile: null, documents: [], facts: [] } as const;

export function emptyStatus(): Response {
  return ok(EMPTY_STATUS);
}
