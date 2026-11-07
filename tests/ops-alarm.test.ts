import { beforeEach, describe, expect, it, vi } from "vitest";

/* The drain alarm with R2 (the files worker) and the mail worker replaced by in-memory fakes. */
const state = vi.hoisted(() => ({
  objects: new Map<string, string>(),
  sent: [] as Array<{ subject: string; text: string }>,
  readFails: false,
  sendOk: true,
}));

vi.mock("@/lib/files", () => ({
  readObject: async (key: string) => {
    if (state.readFails) throw new Error("files worker GET answered 502");
    const v = state.objects.get(key);
    return v === undefined ? null : new TextEncoder().encode(v);
  },
  putObject: async (key: string, body: Uint8Array) => {
    state.objects.set(key, new TextDecoder().decode(body));
    return { bytes: body.byteLength };
  },
}));
vi.mock("@/lib/notify", () => ({
  notifyOwner: async (m: { subject: string; text: string }) => {
    state.sent.push(m);
    return state.sendOk;
  },
}));

import { reportAlarm } from "@/lib/ops-alarm";

const H = 60 * 60 * 1000;
const T0 = Date.parse("2026-11-06T00:00:00Z");
const drain = (ok: boolean, at: number) => reportAlarm({ name: "drain", title: "hourly job drain", ok, detail: ok ? "ok" : "boom", now: new Date(at) });

beforeEach(() => {
  state.objects.clear();
  state.sent.length = 0;
  state.readFails = false;
  state.sendOk = true;
});

describe("server-side owner alarm (hourly drain)", () => {
  it("emails once per incident start and once on recovery, keeping its memory in R2", async () => {
    expect(await drain(false, T0)).toBeNull();
    expect(await drain(false, T0 + H)).toBe("down");
    for (let h = 2; h < 24; h++) expect(await drain(false, T0 + h * H)).toBeNull();
    expect(await drain(true, T0 + 24 * H)).toBe("recovered");
    expect(await drain(true, T0 + 25 * H)).toBeNull();
    expect(state.sent.map((m) => m.subject)).toEqual(["DOWN: hourly job drain", "RECOVERED: hourly job drain"]);
    expect(JSON.parse(state.objects.get("ops/alarms/drain.json") ?? "{}")).toEqual({ fails: 0, since: null, alertedAt: null });
  });

  it("reminds at most once a day while it keeps failing", async () => {
    for (let h = 0; h <= 49; h++) await drain(false, T0 + h * H);
    expect(state.sent.map((m) => m.subject.split(":")[0])).toEqual(["DOWN", "Still DOWN", "Still DOWN"]);
  });

  it("does not write R2 while healthy and nothing changes", async () => {
    await drain(true, T0);
    await drain(true, T0 + H);
    expect(state.objects.size).toBe(0);
    expect(state.sent).toHaveLength(0);
  });

  it("retries the DOWN email on the next failure when the mail worker refused it", async () => {
    state.sendOk = false;
    await drain(false, T0);
    expect(await drain(false, T0 + H)).toBe("down");
    state.sendOk = true;
    expect(await drain(false, T0 + 2 * H)).toBe("down");
    expect(await drain(false, T0 + 3 * H)).toBeNull();
    expect(state.sent).toHaveLength(2);
  });

  it("fails open when its memory is unreachable: a failure is still emailed, a success is not", async () => {
    state.readFails = true;
    expect(await drain(true, T0)).toBeNull();
    expect(await drain(false, T0 + H)).toBe("down");
    expect(state.sent).toHaveLength(1);
  });
});
