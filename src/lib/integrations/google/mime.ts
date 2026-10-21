/*
 * RFC 2822 / MIME message building for Gmail's `users.messages.send` (raw, base64url).
 * Pure and dependency-free so tests pin the exact bytes: UTF-8 subjects as RFC 2047
 * encoded-words (split on character boundaries, each ≤ 75 chars), base64 bodies wrapped at 76,
 * attachments with RFC 2231 filenames, and no header injection (CR/LF never reach a header).
 */

export interface MimeAttachment {
  filename: string;
  contentType: string;
  bytes: Uint8Array;
}

export interface MimeInput {
  from?: { email: string; name?: string | null } | null;
  to: string;
  subject: string;
  text: string;
  attachments?: MimeAttachment[];
  /** Our own Message-ID (`<msg_x@onwardscout.com>`) so replies can be matched back. */
  messageId?: string;
  inReplyTo?: string;
  references?: string[];
  date?: Date;
  /** Fixed boundary for tests. */
  boundary?: string;
}

const enc = new TextEncoder();

function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

/** base64 wrapped at 76 characters per line (RFC 2045). */
export function wrap76(s: string): string {
  return s.replace(/.{1,76}/g, "$&\r\n").replace(/\r\n$/, "");
}

/** Removes CR/LF and other control characters: a header value can never start a new header. */
export function headerSafe(v: string): string {
  return v.replace(/[\r\n\u0000-\u001f\u007f]+/g, " ").trim();
}

function isAscii(s: string): boolean {
  // Printable ASCII only (controls are already gone).
  return /^[\x20-\x7e]*$/.test(s);
}

/**
 * RFC 2047 "B" encoding of a header value; ASCII values pass through. Long values become
 * several encoded-words (each ≤ 75 chars), split between characters, never inside one.
 */
export function encodeHeaderWord(value: string): string {
  const v = headerSafe(value);
  if (isAscii(v)) return v;
  const words: string[] = [];
  let chunk = "";
  // 75 - "=?UTF-8?B?".length - "?=".length = 63 base64 chars → 45 bytes of UTF-8 per word.
  for (const ch of v) {
    if (enc.encode(chunk + ch).length > 45) {
      words.push(chunk);
      chunk = ch;
    } else chunk += ch;
  }
  if (chunk) words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${b64(enc.encode(w))}?=`).join("\r\n ");
}

/** `"Name" <a@b.c>` with the name encoded when needed. */
export function formatAddress(email: string, name?: string | null): string {
  const e = headerSafe(email).replace(/[<>"]/g, "");
  const n = name ? headerSafe(name) : "";
  if (!n) return e;
  if (isAscii(n)) return `"${n.replace(/["\\]/g, "")}" <${e}>`;
  return `${encodeHeaderWord(n)} <${e}>`;
}

/** RFC 2231 `filename*=` plus an ASCII fallback `filename=`. */
function dispositionFilename(filename: string): string {
  const clean = headerSafe(filename).replace(/[\\/]/g, "_") || "attachment";
  const ascii = clean.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  if (isAscii(clean)) return `filename="${ascii}"`;
  return `filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(clean)}`;
}

function rfc2822Date(d: Date): string {
  return d.toUTCString().replace("GMT", "+0000");
}

function boundaryOf(seed?: string): string {
  if (seed) return seed;
  const r = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");
  return `os_${r}`;
}

/** The full message as a string with CRLF line endings. */
export function buildMime(input: MimeInput): string {
  const to = headerSafe(input.to);
  if (!to || /[,;]/.test(to)) throw new Error("Exactly one recipient is allowed per outreach email.");
  const headers: string[] = [];
  if (input.from?.email) headers.push(`From: ${formatAddress(input.from.email, input.from.name)}`);
  headers.push(`To: ${to}`);
  headers.push(`Subject: ${encodeHeaderWord(input.subject)}`);
  headers.push(`Date: ${rfc2822Date(input.date ?? new Date())}`);
  if (input.messageId) headers.push(`Message-ID: ${headerSafe(input.messageId)}`);
  if (input.inReplyTo) headers.push(`In-Reply-To: ${headerSafe(input.inReplyTo)}`);
  if (input.references?.length) headers.push(`References: ${input.references.map(headerSafe).join(" ")}`);
  headers.push("MIME-Version: 1.0");

  const bodyText = input.text.replace(/\r?\n/g, "\r\n");
  const textPart = [`Content-Type: text/plain; charset="UTF-8"`, "Content-Transfer-Encoding: base64", "", wrap76(b64(enc.encode(bodyText)))].join("\r\n");

  const attachments = input.attachments ?? [];
  if (!attachments.length) {
    return [...headers, textPart].join("\r\n") + "\r\n";
  }
  const boundary = boundaryOf(input.boundary);
  const parts = [textPart];
  for (const a of attachments) {
    const type = headerSafe(a.contentType || "application/octet-stream").replace(/[";]/g, "");
    parts.push(
      [
        `Content-Type: ${type}`,
        `Content-Disposition: attachment; ${dispositionFilename(a.filename)}`,
        "Content-Transfer-Encoding: base64",
        "",
        wrap76(b64(a.bytes)),
      ].join("\r\n"),
    );
  }
  return [...headers, `Content-Type: multipart/mixed; boundary="${boundary}"`, "", ...parts.map((p) => `--${boundary}\r\n${p}`), `--${boundary}--`, ""].join("\r\n");
}

/** base64url without padding, as Gmail's `raw` field wants it. */
export function toBase64Url(message: string): string {
  return Buffer.from(message, "utf8").toString("base64url");
}

/** Our Message-ID for a `messages` row: replies quote it in In-Reply-To / References. */
export function messageIdFor(messageRowId: string, domain = "onwardscout.com"): string {
  return `<${messageRowId.replace(/[^A-Za-z0-9_.-]/g, "")}@${domain}>`;
}

/** The `messages` row id inside one of our Message-IDs, or null. */
export function messageRowIdFrom(header: string | null | undefined, domain = "onwardscout.com"): string[] {
  if (!header) return [];
  const out: string[] = [];
  const re = new RegExp(`<(msg_[A-Za-z0-9_.-]+)@${domain.replace(/\./g, "\\.")}>`, "g");
  for (const m of header.matchAll(re)) out.push(m[1]);
  return out;
}
