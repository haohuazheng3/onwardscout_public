import { describe, expect, it } from "vitest";
import en from "@/lib/integrations/messages/en.json";
import zh from "@/lib/integrations/messages/zh.json";

/* The integrations page copy lives next to its code (P3b owns no messages/ namespace file). */
function keys(o: unknown, prefix = ""): string[] {
  if (typeof o !== "object" || o === null) return [prefix];
  return Object.entries(o).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k));
}
function leaf(o: unknown, path: string): string {
  return path.split(".").reduce<unknown>((acc, k) => (acc as Record<string, unknown>)[k], o) as string;
}

describe("integrations copy", () => {
  it("has the same keys in English and Chinese", () => {
    expect(keys(zh).sort()).toEqual(keys(en).sort());
  });
  it("keeps every ICU argument in the translation and has no empty strings", () => {
    for (const k of keys(en)) {
      const args = (s: string) => [...s.matchAll(/\{(\w+)[,}]/g)].map((m) => m[1]).sort();
      expect(args(leaf(zh, k)), k).toEqual(args(leaf(en, k)));
      expect(leaf(en, k).trim(), k).not.toBe("");
      expect(leaf(zh, k).trim(), k).not.toBe("");
    }
  });
});
