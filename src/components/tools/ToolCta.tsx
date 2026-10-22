"use client";

import Link from "next/link";
import { track } from "@/components/Consent";
import { LogoMark } from "@/components/Logo";
import { toolCta, type Tool } from "@/content/tools/types";

/**
 * The strip right under the tool on a tool-first article: the one place that turns what the
 * visitor just made by hand into the next application Onward Scout prepares for them. Dark,
 * like every primary call to action on the site; the click is a `tool_cta` event.
 */
export function ToolCtaStrip({ tool, headline, note }: { tool: Pick<Tool, "id" | "kind" | "ctaLabel" | "ctaHref" | "ctaNote">; headline?: string; note?: string }) {
  const cta = toolCta(tool as Tool);
  return (
    <aside className="pane-ink flex flex-col gap-4 px-6 py-6 sm:flex-row sm:items-center sm:px-8" aria-label="Next step">
      <div className="shrink-0">
        <LogoMark size={36} tone="light" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] opacity-70">Next step</p>
        <p className="mt-1 text-[1.08rem] font-semibold leading-snug text-ink">{headline ?? "Do this once by hand. Let Onward Scout do it for every application after."}</p>
        <p className="mt-1 text-[0.86rem] leading-relaxed opacity-75">{note ?? cta.note ?? "Drop in your résumé: it finds openings you can win and drafts each one for your tap. Free to start."}</p>
      </div>
      <Link href={cta.href} prefetch={false} className="btn btn-primary shrink-0" onClick={() => track("tool_cta", { tool: tool.id, kind: tool.kind, href: cta.href })}>
        {cta.label}
      </Link>
    </aside>
  );
}
