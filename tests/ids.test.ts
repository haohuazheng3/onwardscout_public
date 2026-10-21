import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ID_ALPHABET, ID_PREFIXES, isId, newId, newToken, randomString, sha256, sha256Bytes, shortRef } from "@/lib/ids";

describe("newId", () => {
  it("prefixes every id and uses only the unambiguous alphabet", () => {
    for (const prefix of ID_PREFIXES) {
      const id = newId(prefix);
      expect(id.startsWith(`${prefix}_`)).toBe(true);
      const body = id.slice(prefix.length + 1);
      expect(body).toHaveLength(16);
      for (const ch of body) expect(ID_ALPHABET).toContain(ch);
      expect(isId(id, prefix)).toBe(true);
    }
  });

  it("covers every table prefix of the data model", () => {
    expect([...ID_PREFIXES].sort()).toEqual(
      ["usr", "prf", "doc", "fct", "gol", "mil", "opp", "src", "snp", "mat", "app", "stp", "gen", "msg", "cnt", "evt", "ntf", "aut", "int", "job", "llm", "ord", "sub", "lot", "cev", "err", "inb", "cm", "sbx"].sort(),
    );
  });

  it("does not repeat in practice and is roughly uniform", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i++) seen.add(newId("app"));
    expect(seen.size).toBe(5000);
    const counts = new Map<string, number>();
    for (const ch of randomString(64_000)) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    expect(counts.size).toBe(32);
    for (const n of counts.values()) expect(n).toBeGreaterThan(1500); // expected 2000 each
  });

  it("rejects malformed ids and ids of another type", () => {
    expect(isId("app_abc", "app")).toBe(false); // too short
    expect(isId("app_ILOU12345678", "app")).toBe(false); // excluded letters / uppercase
    expect(isId(newId("doc"), "app")).toBe(false);
    expect(isId("zzz_0123456789abcdef")).toBe(false); // unknown prefix
    expect(isId(42)).toBe(false);
  });

  it("refuses a length that is not a positive integer", () => {
    expect(() => randomString(0)).toThrow();
    expect(() => randomString(2.5)).toThrow();
  });
});

describe("tokens and refs", () => {
  it("newToken is hex of the requested byte length", () => {
    expect(newToken()).toMatch(/^[0-9a-f]{64}$/);
    expect(newToken(16)).toMatch(/^[0-9a-f]{32}$/);
    expect(newToken()).not.toBe(newToken());
  });

  it("shortRef is the uppercase head of the id body", () => {
    expect(shortRef("app_k3v9q2m8x1d4f6h7")).toBe("K3V9Q2M8");
    expect(shortRef("ord_abcdefghjk", 4)).toBe("ABCD");
  });
});

describe("sha256", () => {
  const node = (s: string | Uint8Array) => createHash("sha256").update(s).digest("hex");

  it("matches node:crypto on known vectors", () => {
    expect(sha256("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
  });

  it("matches node:crypto across block boundaries and for UTF-8", () => {
    for (const len of [1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129, 1000]) {
      const s = "x".repeat(len);
      expect(sha256(s)).toBe(node(s));
    }
    for (const s of ["résumé", "替你争取每一个机会", "🧭 onward", "onwardscout:203.0.113.7"]) expect(sha256(s)).toBe(node(s));
    const bytes = new Uint8Array(300).map((_, i) => (i * 37) & 255);
    expect(sha256Bytes(bytes)).toBe(node(bytes));
  });
});
