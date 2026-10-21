import { withErrorCapture } from "@/lib/errors";
import { ok } from "@/lib/profile/http";
import { ensureProfile } from "@/lib/profile/store";
import { profileHistory } from "@/lib/profile/store";
import { isResponse, requireUserApi } from "@/lib/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Recent versions of the profile with what each contained (for "restore"). */
export const GET = withErrorCapture("/api/profile/versions", async () => {
  const session = await requireUserApi();
  if (isResponse(session)) return session;
  const row = await ensureProfile(session.userId);
  const versions = await profileHistory(row.id);
  return ok({
    current: row.version,
    versions: versions.map((v) => ({
      version: v.version,
      createdAt: v.createdAt,
      counts: {
        experience: v.snapshot.experience?.length ?? 0,
        education: v.snapshot.education?.length ?? 0,
        skills: v.snapshot.skills?.length ?? 0,
        roles: v.snapshot.roles?.length ?? 0,
      },
    })),
  });
});
