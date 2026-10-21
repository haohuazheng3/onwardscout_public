import { describe, expect, it, vi } from "vitest";

// The pure helpers under test never touch the database; keep the schema (and F2's domain tables) out of it.
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/db/schema", () => ({ errorGroups: {} }));

import { clientSeverity, effectiveSeverity, fingerprintOf, firstFrame, isNextControlFlow, normalizeError } from "@/lib/errors";

describe("error fingerprinting", () => {
  it("strips line/column numbers and build hashes so deploys don't split groups", () => {
    const a = firstFrame("Error: x\n    at handler (/var/task/.next/server/chunks/8a7f3c2d9e1b.js:12:345)");
    const b = firstFrame("Error: x\n    at handler (/var/task/.next/server/chunks/1b2c3d4e5f6a.js:99:1)");
    expect(a).toBe(b);
    expect(a).toContain("at handler");
  });

  it("reads Firefox/Safari style frames and query strings", () => {
    const f = firstFrame("render@https://onwardscout.com/_next/static/chunks/page-abcdef0123.js?v=3:1:200");
    expect(f).toBe("render@https://onwardscout.com/_next/static/chunks/page-#.js");
    expect(firstFrame("no frames here")).toBe("");
  });

  it("groups by name + frame + route, not by message", () => {
    const f = firstFrame("TypeError: y\n    at go (file.js:1:2)");
    expect(fingerprintOf("TypeError", f, "/a", "y")).toBe(fingerprintOf("TypeError", f, "/a", "different message"));
    expect(fingerprintOf("TypeError", f, "/a", "y")).not.toBe(fingerprintOf("TypeError", f, "/b", "y"));
    expect(fingerprintOf("TypeError", f, "/a", "y")).not.toBe(fingerprintOf("RangeError", f, "/a", "y"));
    expect(fingerprintOf("TypeError", f, "/a", "y")).toMatch(/^[0-9a-f]{40}$/);
  });

  it("falls back to the message (digits masked) when there is no stack", () => {
    expect(fingerprintOf("Error", "", "/a", "boom 1")).toBe(fingerprintOf("Error", "", "/a", "boom 2"));
    expect(fingerprintOf("Error", "", "/a", "boom")).not.toBe(fingerprintOf("Error", "", "/a", "other"));
  });
});

describe("normalizing thrown values", () => {
  it("handles errors, plain objects, circular objects and primitives", () => {
    expect(normalizeError(new TypeError("bad"))).toMatchObject({ name: "TypeError", message: "bad" });
    expect(normalizeError({ name: "PostgresError", message: "relation missing" })).toMatchObject({ name: "PostgresError", message: "relation missing" });
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    expect(normalizeError(circular).name).toBe("NonError");
    expect(normalizeError("plain string")).toEqual({ name: "NonError", message: "plain string", stack: "" });
    expect(normalizeError(undefined).message).toBe("undefined");
  });
});

describe("severity classification", () => {
  const hydration = "Minified React error #418; visit https://react.dev/errors/418?args[]=HTML&args[]= for the full message";
  it("keeps browser hydration mismatches out of the severe bucket", () => {
    expect(effectiveSeverity("client", "error", hydration)).toBe("warn");
    expect(effectiveSeverity("client", "error", "Hydration failed because the server rendered HTML didn't match the client.")).toBe("warn");
  });
  it("leaves other client errors and all server errors alone", () => {
    expect(effectiveSeverity("client", "error", "TypeError: x is undefined")).toBe("error");
    expect(effectiveSeverity("server", "error", hydration)).toBe("error");
    expect(effectiveSeverity("client", "warn", "anything")).toBe("warn");
  });
});

describe("client-reported severity", () => {
  const ours = "TypeError: x\n    at render (https://onwardscout.com/_next/static/chunks/app/page-8a7f3c2d.js:1:200)";
  it("keeps \"error\" only for a stack that runs through our own bundle", () => {
    expect(clientSeverity("error", ours)).toBe("error");
  });
  it("downgrades anything else: no stack, a foreign script, an extension frame, or a plain warn", () => {
    expect(clientSeverity("error", undefined)).toBe("warn");
    expect(clientSeverity("error", "Error: y\n    at https://cdn.example.com/widget.js:1:1")).toBe("warn");
    expect(clientSeverity("error", `${ours}\n    at chrome-extension://abc/content.js:1:1`)).toBe("warn");
    expect(clientSeverity("warn", ours)).toBe("warn");
  });
});

describe("Next control flow", () => {
  it("recognises redirect / notFound digests so wrappers rethrow them", () => {
    expect(isNextControlFlow(Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/sign-in;307;" }))).toBe(true);
    expect(isNextControlFlow(Object.assign(new Error("x"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" }))).toBe(true);
    expect(isNextControlFlow(new Error("ordinary"))).toBe(false);
    expect(isNextControlFlow(null)).toBe(false);
  });
});
