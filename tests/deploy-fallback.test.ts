import { describe, expect, it } from "vitest";
import { decideFallback, FALLBACK_CONCLUSIONS, signatureMatches, signBody } from "@/lib/deploy-fallback";

const secret = "s3cret";

function run(over: Record<string, unknown> = {}, action = "completed") {
  return {
    action,
    workflow_run: {
      path: ".github/workflows/deploy.yml@refs/heads/main",
      head_branch: "main",
      head_sha: "abc1234def",
      conclusion: "failure",
      html_url: "https://github.com/o/r/actions/runs/1",
      ...over,
    },
  };
}

describe("GitHub webhook signature", () => {
  it("accepts the HMAC GitHub sends and nothing else", () => {
    const body = JSON.stringify({ zen: "Keep it logically awesome." });
    expect(signatureMatches(body, signBody(body, secret), secret)).toBe(true);
    const sig = signBody(body, secret);
    expect(signatureMatches(body, "sha256=" + sig.slice("sha256=".length).toUpperCase(), secret)).toBe(true);
    expect(signatureMatches(body + " ", signBody(body, secret), secret)).toBe(false);
    expect(signatureMatches(body, signBody(body, "other"), secret)).toBe(false);
    expect(signatureMatches(body, null, secret)).toBe(false);
    expect(signatureMatches(body, "sha1=abc", secret)).toBe(false);
    expect(signatureMatches(body, "sha256=abc", secret)).toBe(false);
  });
});

describe("deploy fallback decision", () => {
  it("answers ping and ignores other events", () => {
    expect(decideFallback("ping", { zen: "x" })).toEqual({ kind: "pong" });
    expect(decideFallback("push", run()).kind).toBe("ignore");
    expect(decideFallback(null, run()).kind).toBe("ignore");
  });

  it("falls back only for a completed Deploy run on main that did not deploy", () => {
    for (const conclusion of FALLBACK_CONCLUSIONS) {
      const d = decideFallback("workflow_run", run({ conclusion }));
      expect(d).toEqual({ kind: "fallback", conclusion, sha: "abc1234def", runUrl: "https://github.com/o/r/actions/runs/1" });
    }
  });

  it("ignores successes, cancellations, other workflows, other branches and in-progress runs", () => {
    expect(decideFallback("workflow_run", run({ conclusion: "success" })).kind).toBe("ignore");
    expect(decideFallback("workflow_run", run({ conclusion: "cancelled" })).kind).toBe("ignore");
    expect(decideFallback("workflow_run", run({ conclusion: null })).kind).toBe("ignore");
    expect(decideFallback("workflow_run", run({ path: ".github/workflows/ci.yml@refs/heads/main" })).kind).toBe("ignore");
    expect(decideFallback("workflow_run", run({ head_branch: "feature" })).kind).toBe("ignore");
    expect(decideFallback("workflow_run", run({}, "requested")).kind).toBe("ignore");
    expect(decideFallback("workflow_run", run({}, "in_progress")).kind).toBe("ignore");
  });

  it("tolerates a payload with nothing in it", () => {
    expect(decideFallback("workflow_run", null).kind).toBe("ignore");
    expect(decideFallback("workflow_run", { action: "completed" }).kind).toBe("ignore");
  });
});
