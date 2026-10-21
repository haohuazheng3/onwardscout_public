import { describe, expect, it } from "vitest";
import { ANON_COOKIE, isAnonId, signAnonId, verifyAnonCookie } from "@/lib/profile/anon-cookie";
import { checkUpload, extensionFor, fileExtension, formatBytes, isLinkedInUrl, safeFilename, splitLinks, UPLOAD_LIMITS, uploadContentType } from "@/lib/profile/uploads";

describe("upload rules", () => {
  it("decides the content type from the browser and the extension", () => {
    expect(uploadContentType("CV.PDF", "application/pdf")).toBe("application/pdf");
    expect(uploadContentType("notes.md", "")).toBe("text/markdown");
    expect(uploadContentType("notes.md", "text/x-markdown")).toBe("text/markdown");
    expect(uploadContentType("readme.txt", "application/octet-stream")).toBe("text/plain");
    expect(uploadContentType("deck.pptx", "")).toBe("application/vnd.openxmlformats-officedocument.presentationml.presentation");
    expect(uploadContentType("photo.jpeg", "image/jpeg")).toBe("image/jpeg");
    expect(uploadContentType("cv.pdf", "image/png")).toBe("application/pdf");
    expect(uploadContentType("song.mp3", "audio/mpeg")).toBeNull();
    expect(uploadContentType("legacy.doc", "application/msword")).toBeNull();
    expect(extensionFor("text/markdown")).toBe("md");
    expect(fileExtension("a.b.DOCX")).toBe("docx");
    expect(fileExtension("noext")).toBe("");
  });

  it("checks type, size, emptiness and count before uploading", () => {
    expect(checkUpload({ name: "cv.pdf", type: "application/pdf", size: 1000 })).toBeNull();
    expect(checkUpload({ name: "cv.exe", type: "application/x-msdownload", size: 1000 })).toBe("type");
    expect(checkUpload({ name: "cv.pdf", type: "application/pdf", size: 0 })).toBe("empty");
    expect(checkUpload({ name: "cv.pdf", type: "application/pdf", size: UPLOAD_LIMITS.maxBytes + 1 })).toBe("size");
    expect(checkUpload({ name: "cv.pdf", type: "application/pdf", size: 10 }, UPLOAD_LIMITS.maxFiles)).toBe("count");
  });

  it("cleans file names and formats sizes", () => {
    expect(safeFilename("C:\\Users\\me\\My CV.pdf")).toBe("My CV.pdf");
    expect(safeFilename("bad\u0000name.pdf")).toBe("badname.pdf");
    expect(safeFilename("x".repeat(300) + ".pdf")).toHaveLength(120);
    expect(safeFilename("x".repeat(300) + ".pdf").endsWith(".pdf")).toBe(true);
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(3.5 * 1024 * 1024)).toBe("3.5 MB");
  });

  it("splits pasted links and spots LinkedIn", () => {
    expect(splitLinks("github.com/ann, https://ann.dev\nhttps://ann.dev/ orcid 0000-0002-1825-0097；example")).toEqual(["github.com/ann", "https://ann.dev", "0000-0002-1825-0097"]);
    expect(isLinkedInUrl("https://www.linkedin.com/in/ann")).toBe(true);
    expect(isLinkedInUrl("lnkd.in/abc")).toBe(true);
    expect(isLinkedInUrl("https://notlinkedin.example.com")).toBe(false);
  });
});

describe("anonymous draft cookie", () => {
  const secret = ["test", "secret", "value"].join("-");
  const id = "anon_0123456789abcdef";

  it("signs and verifies", () => {
    expect(ANON_COOKIE).toBe("os_anon");
    expect(isAnonId(id)).toBe(true);
    const v = signAnonId(id, secret);
    expect(verifyAnonCookie(v, secret)).toBe(id);
  });

  it("refuses forged, malformed or unsigned values", () => {
    const v = signAnonId(id, secret);
    expect(verifyAnonCookie(v, `${secret}x`)).toBeNull();
    expect(verifyAnonCookie(v.replace(id, "anon_0123456789abcdeg"), secret)).toBeNull();
    expect(verifyAnonCookie(id, secret)).toBeNull();
    expect(verifyAnonCookie("anon_ILOU456789abcdef.0000", secret)).toBeNull();
    expect(verifyAnonCookie(undefined, secret)).toBeNull();
    expect(verifyAnonCookie(v, undefined)).toBeNull();
    expect(() => signAnonId("user_123", secret)).toThrow();
  });
});
