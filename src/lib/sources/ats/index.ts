/*
 * The three public ATS clients behind one interface, plus the board list loader
 * (content/seed/ats-boards.json, maintained by the research team).
 */
import { z } from "zod";
import { ATS_PROVIDERS, type AtsProvider } from "@/lib/core/types";
import { industryCodes, orgSlugOf } from "../normalize";
import type { BoardContext, BoardRef, JobInput } from "../types";
import { fetchAshbyBoard, ashbyBoardUrl } from "./ashby";
import type { FetchJsonOptions } from "./common";
import { fetchGreenhouseBoard, greenhouseBoardUrl } from "./greenhouse";
import { fetchLeverBoard, leverBoardUrl } from "./lever";

export interface AtsBoardFetch {
  inputs: JobInput[];
  /** Postings whose shape we did not recognise (skipped). */
  invalid: number;
  /** Postings the board listed. */
  total: number;
}

export interface AtsClient {
  provider: AtsProvider;
  /** Canonical API URL of a board (also `sources.url`). */
  boardUrl(token: string): string;
  fetchBoard(token: string, opts?: FetchJsonOptions): Promise<AtsBoardFetch>;
}

export const ATS_CLIENTS: Record<AtsProvider, AtsClient> = {
  greenhouse: { provider: "greenhouse", boardUrl: greenhouseBoardUrl, fetchBoard: fetchGreenhouseBoard },
  lever: { provider: "lever", boardUrl: (t) => leverBoardUrl(t), fetchBoard: fetchLeverBoard },
  ashby: { provider: "ashby", boardUrl: ashbyBoardUrl, fetchBoard: fetchAshbyBoard },
};

export function isAtsProvider(v: unknown): v is AtsProvider {
  return typeof v === "string" && (ATS_PROVIDERS as readonly string[]).includes(v);
}

export function boardContext(b: Pick<BoardRef, "provider" | "token" | "company" | "industries">): BoardContext {
  return {
    provider: b.provider,
    token: b.token,
    company: b.company,
    orgSlug: orgSlugOf(b.company) ?? b.token,
    industries: industryCodes(b.industries),
  };
}

export const boardRefSchema = z.object({
  provider: z.enum(ATS_PROVIDERS),
  token: z.string().trim().min(1).max(120),
  company: z.string().trim().min(1).max(200),
  industries: z.array(z.string()).default([]),
  hq: z.string().nullish().transform((v) => (v && /^[A-Za-z]{2}$/.test(v) ? v.toUpperCase() : null)),
  jobCount: z.number().int().nonnegative().optional(),
});

/** Parses the board list; invalid rows are reported, duplicates (provider + token) dropped. */
export function parseBoards(json: unknown): { boards: BoardRef[]; invalid: Array<{ index: number; issues: string[] }> } {
  const items = Array.isArray(json) ? json : [];
  const boards: BoardRef[] = [];
  const invalid: Array<{ index: number; issues: string[] }> = [];
  const seen = new Set<string>();
  items.forEach((item, index) => {
    const r = boardRefSchema.safeParse(item);
    if (!r.success) {
      invalid.push({ index, issues: r.error.issues.map((i) => `${i.path.join(".") || "(entry)"}: ${i.message}`) });
      return;
    }
    const k = `${r.data.provider}:${r.data.token.toLowerCase()}`;
    if (seen.has(k)) return;
    seen.add(k);
    boards.push({ ...r.data, hq: r.data.hq ?? null });
  });
  return { boards, invalid };
}
