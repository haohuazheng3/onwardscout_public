"use client";

/*
 * Client calls for onboarding and the profile. `mode` picks the route family: "draft" for
 * /app/start before sign-in (anonymous draft, /api/drafts/*), "user" for a signed-in person
 * (/api/uploads/*, /api/profile*, /api/goals). Failures throw an Error whose message is the
 * server's human sentence (or a network sentence), ready for a toast.
 */

export type ApiMode = "draft" | "user";

export const ENDPOINTS = {
  draft: {
    sign: "/api/drafts/upload/sign",
    complete: "/api/drafts/upload/complete",
    links: "/api/drafts/links",
    note: "/api/drafts/note",
    status: "/api/drafts/status",
    profile: "/api/drafts/profile",
    goals: "/api/drafts/goals",
    finish: "/api/drafts/finish",
    documents: "/api/drafts/documents",
  },
  user: {
    sign: "/api/uploads/sign",
    complete: "/api/uploads/complete",
    links: "/api/uploads/link",
    note: "/api/uploads/note",
    status: "/api/profile/status",
    profile: "/api/profile",
    goals: "/api/goals",
    finish: "/api/onboarding/finish",
    documents: "/api/documents",
  },
} as const;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly data: Record<string, unknown> | null = null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** JSON request; throws ApiError with the server's sentence, or the given network sentence. */
export async function api<T>(url: string, init: RequestInit & { json?: unknown } = {}, messages: { network: string; generic: string } = { network: "We couldn't reach the server. Check your connection and try again.", generic: "Something went wrong. Please try again." }): Promise<T> {
  const { json, headers, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(url, {
      credentials: "same-origin",
      cache: "no-store",
      ...rest,
      headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...(headers ?? {}) },
      ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
    });
  } catch {
    throw new ApiError(messages.network, 0);
  }
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) throw new ApiError(typeof data?.error === "string" ? data.error : messages.generic, res.status, data);
  return data as T;
}

/** PUT a file to a signed URL with upload progress (0–1). Resolves on 2xx. */
export function putFile(url: string, file: Blob, contentType: string, onProgress: (ratio: number) => void, register?: (xhr: XMLHttpRequest) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    register?.(xhr);
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.min(1, e.loaded / Math.max(1, e.total)));
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new ApiError(`upload ${xhr.status}`, xhr.status)));
    xhr.onerror = () => reject(new ApiError("network", 0));
    xhr.onabort = () => reject(new ApiError("aborted", -1));
    xhr.send(file);
  });
}

/* ------------------------------------------------------------------ shared response shapes */

export interface StatusDoc {
  id: string;
  kind: string;
  filename: string | null;
  sourceUrl: string | null;
  status: "uploaded" | "parsing" | "parsed" | "failed" | string;
  source: "file" | "link" | "note";
  error: string | null;
  warnings: string[];
  skipped: string | null;
  counts: Record<string, number>;
}

export interface DraftStatusView {
  phase: "empty" | "reading" | "building" | "ready";
  profile: { status: string; version: number; completeness: number; counts: Record<string, number> } | null;
  documents: StatusDoc[];
  facts: { id: string; path: string; claim: string }[];
}
