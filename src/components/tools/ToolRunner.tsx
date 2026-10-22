"use client";

import type { Tool } from "@/content/tools/types";
import { BriefView } from "./Brief";
import { CalculatorView } from "./Calculator";
import { CheckerView } from "./Checker";
import { ChecklistView } from "./Checklist";
import { DecisionView } from "./Decision";
import { FinderView } from "./Finder";
import { GeneratorView } from "./Generator";
import { KeywordsView } from "./Keywords";
import { QuizView } from "./Quiz";
import { TeleprompterView } from "./Teleprompter";
import { TrackerView } from "./Tracker";
import { useEffect } from "react";
import { useHydrated } from "./shared";

/*
 * The interactive tool at the top of a tool-first article. The server passes one validated
 * tool definition (plain JSON) and the page URL; everything runs in the browser and nothing
 * the visitor types is sent anywhere. Until React has hydrated, the pane shows a skeleton in
 * the tool's shape, so the article around it is readable without JavaScript.
 *
 * Analytics (FlowGlance, after consent) never sees tool content: the article body carries an
 * explicit data-fw-capture marker, so page-content capture skips this pane, and copy events
 * from inside [data-os-private] stop at the window before any document listener runs (the
 * copy itself still happens).
 */

declare global {
  interface Window {
    __osCopyGuard?: boolean;
  }
}

export function installPrivateCopyGuard(): void {
  if (typeof window === "undefined" || window.__osCopyGuard) return;
  window.__osCopyGuard = true;
  window.addEventListener(
    "copy",
    (e) => {
      const node = window.getSelection()?.anchorNode ?? null;
      const el = node ? (node.nodeType === 1 ? (node as Element) : node.parentElement) : null;
      const active = document.activeElement;
      if (el?.closest("[data-os-private]") || active?.closest("[data-os-private]")) e.stopPropagation();
    },
    true,
  );
}

function ToolSkeleton({ kind }: { kind: Tool["kind"] }) {
  const stacked = kind === "quiz" || kind === "decision" || kind === "checklist" || kind === "checker" || kind === "finder" || kind === "tracker";
  const rows = kind === "quiz" || kind === "decision" ? 3 : kind === "checklist" || kind === "finder" ? 5 : 2;
  return (
    <div aria-hidden="true" className="space-y-3">
      {kind === "quiz" || kind === "decision" ? <div className="skeleton h-2 w-full" /> : null}
      <div className={`grid gap-3 ${stacked ? "" : "sm:grid-cols-2"}`}>
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className={`skeleton ${kind === "checker" || kind === "keywords" ? "h-36" : "h-12"}`} />
        ))}
      </div>
      <div className="skeleton h-12 w-40 !rounded-full" />
    </div>
  );
}

export function ToolRunner({ tool, pageUrl }: { tool: Tool; pageUrl: string }) {
  const hydrated = useHydrated();
  useEffect(installPrivateCopyGuard, []);
  return (
    <section aria-labelledby={`tool-${tool.id}`} className="min-w-0" data-os-private="">
      <p className="eyebrow eyebrow-accent">Free tool · runs in your browser</p>
      <h2 id={`tool-${tool.id}`} className="headline mt-2 text-[1.55rem] text-ink sm:text-[1.8rem]">
        {tool.title}
      </h2>
      <p className="mt-2 text-[0.98rem] leading-relaxed text-ink-3">{tool.lede}</p>
      <div className="mt-5">
        {!hydrated ? (
          <ToolSkeleton kind={tool.kind} />
        ) : tool.kind === "generator" ? (
          <GeneratorView tool={tool} />
        ) : tool.kind === "calculator" ? (
          <CalculatorView tool={tool} />
        ) : tool.kind === "checker" ? (
          <CheckerView tool={tool} />
        ) : tool.kind === "quiz" ? (
          <QuizView tool={tool} pageUrl={pageUrl} />
        ) : tool.kind === "decision" ? (
          <DecisionView tool={tool} />
        ) : tool.kind === "checklist" ? (
          <ChecklistView tool={tool} />
        ) : tool.kind === "teleprompter" ? (
          <TeleprompterView tool={tool} />
        ) : tool.kind === "keywords" ? (
          <KeywordsView tool={tool} />
        ) : tool.kind === "tracker" ? (
          <TrackerView tool={tool} />
        ) : tool.kind === "finder" ? (
          <FinderView tool={tool} />
        ) : (
          <BriefView tool={tool} />
        )}
      </div>
      <p className="mt-5 text-[0.8rem] leading-relaxed text-ink-4">Nothing you type here is uploaded or stored by Onward Scout; the tool runs entirely in your browser.</p>
    </section>
  );
}
