"use client";

/*
 * Client calls for the applications area. Failures throw RequestError whose message is the
 * server's human sentence (or a network sentence), ready for a toast.
 */

export class RequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly data: Record<string, unknown> | null = null,
  ) {
    super(message);
    this.name = "RequestError";
  }
}

export interface CallMessages {
  network: string;
  generic: string;
}

export async function call<T>(url: string, init: { method?: "GET" | "POST" | "PATCH"; json?: unknown; signal?: AbortSignal } = {}, messages?: CallMessages): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method ?? (init.json !== undefined ? "POST" : "GET"),
      credentials: "same-origin",
      cache: "no-store",
      signal: init.signal,
      headers: init.json !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new RequestError(messages?.network ?? "We couldn't reach the server. Check your connection and try again.", 0);
  }
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) throw new RequestError(typeof data?.error === "string" ? data.error : (messages?.generic ?? "Something went wrong. Please try again."), res.status, data);
  return data as T;
}

/** PUT a file to a signed upload URL with progress (0–1). */
export function putFile(url: string, file: Blob, contentType: string, onProgress: (ratio: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.min(1, e.loaded / Math.max(1, e.total)));
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new RequestError(`upload ${xhr.status}`, xhr.status)));
    xhr.onerror = () => reject(new RequestError("network", 0));
    xhr.send(file);
  });
}

const TYPES: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  txt: "text/plain",
  zip: "application/zip",
  mp4: "video/mp4",
};

/** The content type the upload route accepts for a file (browser types are unreliable for Office files). */
export function uploadType(file: File): string | null {
  const ext = /\.([a-z0-9]{1,8})$/i.exec(file.name)?.[1]?.toLowerCase() ?? "";
  return TYPES[ext] ?? (Object.values(TYPES).includes(file.type) ? file.type : null);
}

/** Starts a download from a signed link without leaving the page. */
export function startDownload(url: string, filename: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
