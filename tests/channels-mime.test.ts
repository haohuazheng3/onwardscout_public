import { describe, expect, it } from "vitest";
import { buildMime, encodeHeaderWord, formatAddress, headerSafe, messageIdFor, messageRowIdFrom, toBase64Url, wrap76 } from "@/lib/integrations/google/mime";

/** Decodes RFC 2047 encoded-words back to text (test helper). */
function decodeWords(v: string): string {
  return v
    .split(/\r\n /)
    .map((w) => {
      const m = /^=\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=$/.exec(w);
      return m ? Buffer.from(m[1], "base64").toString("utf8") : w;
    })
    .join("");
}

function headerBlock(mime: string): string {
  return mime.split("\r\n\r\n")[0];
}

function header(mime: string, name: string): string | null {
  const unfolded = headerBlock(mime).replace(/\r\n /g, "\r\n ").split(/\r\n(?! )/);
  const line = unfolded.find((l) => l.toLowerCase().startsWith(`${name.toLowerCase()}:`));
  return line ? line.slice(name.length + 1).trim() : null;
}

const DATE = new Date("2026-10-21T09:30:00Z");

describe("plain text email", () => {
  const mime = buildMime({ from: { email: "mei@example.com", name: "Mei Chen" }, to: "partner@fund.example", subject: "Intro: Kite (pre-seed, climate logistics)", text: "Hi Sam,\nShort note.\n\nMei", date: DATE, messageId: "<msg_abc@onwardscout.com>" });

  it("has the headers Gmail needs, CRLF line endings and no attachment boundary", () => {
    expect(header(mime, "From")).toBe('"Mei Chen" <mei@example.com>');
    expect(header(mime, "To")).toBe("partner@fund.example");
    expect(header(mime, "Subject")).toBe("Intro: Kite (pre-seed, climate logistics)");
    expect(header(mime, "Date")).toBe("Wed, 21 Oct 2026 09:30:00 +0000");
    expect(header(mime, "Message-ID")).toBe("<msg_abc@onwardscout.com>");
    expect(header(mime, "MIME-Version")).toBe("1.0");
    expect(header(mime, "Content-Type")).toBe('text/plain; charset="UTF-8"');
    expect(header(mime, "Content-Transfer-Encoding")).toBe("base64");
    expect(mime).not.toMatch(/[^\r]\n/);
    expect(mime).not.toMatch(/multipart/);
  });

  it("carries the body as UTF-8 base64 with CRLF newlines", () => {
    const body = mime.split("\r\n\r\n").slice(1).join("\r\n\r\n").replace(/\r\n/g, "");
    expect(Buffer.from(body, "base64").toString("utf8")).toBe("Hi Sam,\r\nShort note.\r\n\r\nMei");
  });
});

describe("UTF-8 subjects and names", () => {
  it("leaves ASCII alone and encodes everything else as RFC 2047 words", () => {
    expect(encodeHeaderWord("Hello")).toBe("Hello");
    const subject = "申请：2027 年春季创业营（Onward Scout 推荐）";
    const enc = encodeHeaderWord(subject);
    expect(enc).toMatch(/^=\?UTF-8\?B\?/);
    expect(decodeWords(enc)).toBe(subject);
  });

  it("splits long subjects into words of at most 75 characters, never inside a character", () => {
    const subject = "Résumé — candidature pour le poste de développeuse 🚀 ".repeat(4).trim();
    const enc = encodeHeaderWord(subject);
    const words = enc.split("\r\n ");
    expect(words.length).toBeGreaterThan(1);
    for (const w of words) {
      expect(w.length).toBeLessThanOrEqual(75);
      expect(() => new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(/\?B\?(.*)\?=$/.exec(w)![1], "base64"))).not.toThrow();
    }
    expect(decodeWords(enc)).toBe(subject);
  });

  it("encodes a non-ASCII display name", () => {
    const from = formatAddress("li@example.com", "李伟");
    expect(from).toMatch(/^=\?UTF-8\?B\?.+\?= <li@example.com>$/);
    expect(decodeWords(from.replace(/ <li@example.com>$/, ""))).toBe("李伟");
  });
});

describe("header safety", () => {
  it("strips CR/LF so a value can never start a new header", () => {
    expect(headerSafe("Hello\r\nBcc: victim@example.com")).toBe("Hello Bcc: victim@example.com");
    const mime = buildMime({ to: "a@example.com", subject: "Hi\r\nBcc: x@example.com", text: "t", date: DATE });
    expect(headerBlock(mime).split("\r\n").filter((l) => /^bcc:/i.test(l))).toEqual([]);
    expect(header(mime, "Subject")).toBe("Hi Bcc: x@example.com");
  });

  it("allows exactly one recipient", () => {
    expect(() => buildMime({ to: "a@example.com, b@example.com", subject: "s", text: "t" })).toThrow(/one recipient/);
    expect(() => buildMime({ to: "a@example.com; b@example.com", subject: "s", text: "t" })).toThrow(/one recipient/);
  });

  it("removes quotes and brackets from display names", () => {
    expect(formatAddress("a@example.com", 'Eve "admin"')).toBe('"Eve admin" <a@example.com>');
    expect(formatAddress("a@example.com", null)).toBe("a@example.com");
  });
});

describe("attachments", () => {
  const pdf = new Uint8Array(Buffer.from("%PDF-1.4\n" + "x".repeat(200)));
  const mime = buildMime({
    to: "hiring@example.com",
    subject: "Application",
    text: "Attached.",
    attachments: [
      { filename: "Mei-Chen-resume.pdf", contentType: "application/pdf", bytes: pdf },
      { filename: "陈美-求职信.docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", bytes: new Uint8Array([1, 2, 3]) },
    ],
    boundary: "os_testboundary",
    date: DATE,
    inReplyTo: "<msg_a@onwardscout.com>",
    references: ["<msg_a@onwardscout.com>", "<msg_b@onwardscout.com>"],
  });

  it("is multipart/mixed with one text part and one part per file", () => {
    expect(header(mime, "Content-Type")).toBe('multipart/mixed; boundary="os_testboundary"');
    expect(mime.split("--os_testboundary\r\n")).toHaveLength(4);
    expect(mime.trimEnd().endsWith("--os_testboundary--")).toBe(true);
    expect(header(mime, "In-Reply-To")).toBe("<msg_a@onwardscout.com>");
    expect(header(mime, "References")).toBe("<msg_a@onwardscout.com> <msg_b@onwardscout.com>");
  });

  it("names files with an ASCII fallback and RFC 2231 UTF-8", () => {
    expect(mime).toContain('Content-Disposition: attachment; filename="Mei-Chen-resume.pdf"');
    expect(mime).toContain(`filename*=UTF-8''${encodeURIComponent("陈美-求职信.docx")}`);
  });

  it("base64-encodes file bytes in lines of at most 76 characters", () => {
    const part = mime.split("--os_testboundary\r\n")[2];
    const [, data] = part.split("\r\n\r\n");
    const lines = data.trim().split("\r\n");
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(76);
    expect(Buffer.from(lines.join(""), "base64").equals(Buffer.from(pdf))).toBe(true);
  });
});

describe("helpers", () => {
  it("wraps base64 at 76", () => {
    expect(wrap76("a".repeat(160)).split("\r\n").map((l) => l.length)).toEqual([76, 76, 8]);
  });
  it("produces Gmail's base64url raw value", () => {
    const raw = toBase64Url("Subject: ü?\r\n\r\n>>>");
    expect(raw).not.toMatch(/[+/=]/);
    expect(Buffer.from(raw, "base64url").toString("utf8")).toBe("Subject: ü?\r\n\r\n>>>");
  });
  it("round-trips our Message-IDs", () => {
    expect(messageIdFor("msg_k3v9q2m8")).toBe("<msg_k3v9q2m8@onwardscout.com>");
    expect(messageRowIdFrom("<CAF=abc@mail.gmail.com> <msg_k3v9q2m8@onwardscout.com>")).toEqual(["msg_k3v9q2m8"]);
    expect(messageRowIdFrom(null)).toEqual([]);
  });
});
