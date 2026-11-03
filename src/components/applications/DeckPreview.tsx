"use client";

import { PenLine } from "lucide-react";
import { useTranslations } from "next-intl";
import type { CSSProperties } from "react";
import type { DocumentBlockView } from "@/lib/applications/types";
import { deckSlides } from "@/lib/documents/deck";

/*
 * The pitch deck as the investor or the programme will see it: the same slides the PDF and the
 * PPTX lay out (deck.ts), drawn at the width of the room. Fixed slide colours, not the site's
 * theme: it is the founder's document, so it looks the same in light and dark mode. Text scales
 * with the slide (container units) but never below a readable size: on a phone a slide with a lot
 * on it grows taller instead of shrinking its text.
 */

const INK = "#121614";
const INK2 = "#3E4541";
const MUTED = "#626A65";
const ACCENT = "#1E5A48";

const frame: CSSProperties = { containerType: "inline-size" };

/** Scales with the slide, never below a size a phone can read (the slide then grows taller). */
const size = (cqw: number, px: number) => `max(${cqw}cqw, ${px}px)`;

export function DeckPreview({ blocks, onFillGap }: { blocks: DocumentBlockView[]; onFillGap?: () => void }) {
  const t = useTranslations("applications.documents");
  const slides = deckSlides(
    blocks.map((b) => ({ type: b.type, text: b.text, ...(b.label ? { label: b.label } : {}), factIds: b.factIds, flags: b.flags as ("unsourced" | "needs_confirmation")[] })),
    "Overview",
  );
  const brand = slides[0]?.title ?? "";

  return (
    <ol className="grid min-w-0 gap-3" aria-label={t("view.slides")}>
      {slides.map((s, n) => {
        const label = t("slide", { n: n + 1, total: slides.length });
        if (s.layout === "title") {
          const lines = s.items.filter((i) => i.kind === "statement" || i.kind === "gap");
          const people = s.items.filter((i) => i.kind === "point");
          return (
            <li key={n} aria-label={label} style={{ ...frame, background: INK }} className="relative aspect-video min-w-0 rounded-[16px] shadow-[0_0_0_1px_var(--line-2)]">
              <div className="flex min-h-full flex-col justify-center" style={{ padding: "max(5cqw, 20px) 6cqw" }}>
                <p className="font-bold leading-[1.08]" style={{ color: "#fff", fontSize: size(5.4, 26) }}>
                  {s.title}
                </p>
                {lines.map((l) => (
                  <p key={l.block} className="leading-snug" style={{ color: l.kind === "gap" ? "#E0B44C" : "#C9CFCB", fontSize: size(2.4, 14), marginTop: "1.6cqw" }}>
                    {l.text}
                  </p>
                ))}
                <span aria-hidden className="block rounded-full" style={{ background: "#5FC2A0", width: "10cqw", height: "0.6cqw", marginTop: "2.6cqw" }} />
                {people.length ? (
                  <p style={{ color: "#A3ABA6", fontSize: size(1.7, 12), marginTop: "1.8cqw" }}>{people.map((p) => p.text).join("   ·   ")}</p>
                ) : null}
              </div>
            </li>
          );
        }
        const metrics = s.items.filter((i) => i.kind === "metric").slice(0, 4);
        const rest = s.items.filter((i) => !metrics.includes(i));
        return (
          <li key={n} aria-label={label} style={frame} className="relative aspect-video min-w-0 rounded-[16px] bg-white shadow-[0_0_0_1px_var(--line-2)]">
            <div className="flex min-h-full flex-col" style={{ padding: "max(4.4cqw, 16px) 6cqw max(6.4cqw, 36px)" }}>
              <p className="font-bold leading-tight" style={{ color: INK, fontSize: size(3, 18) }}>
                {s.title}
              </p>
              <span aria-hidden className="block rounded-full" style={{ background: ACCENT, width: "6.6cqw", height: "0.5cqw", margin: "1.1cqw 0 2.6cqw" }} />
              {metrics.length ? (
                <div className="grid" style={{ gridTemplateColumns: `repeat(${metrics.length}, minmax(0, 1fr))`, gap: "1.6cqw", marginBottom: "2.2cqw" }}>
                  {metrics.map((m) => (
                    <div key={m.block} className="min-w-0" style={{ background: "#F5F4F0", border: "1px solid #E3E5E1", borderRadius: "1.2cqw", padding: "1.8cqw 2cqw" }}>
                      <p className="truncate font-bold leading-none" style={{ color: ACCENT, fontSize: size(3.4, 20) }}>
                        {m.text}
                      </p>
                      {m.label ? (
                        <p className="leading-snug" style={{ color: INK2, fontSize: size(1.35, 11), marginTop: "0.9cqw" }}>
                          {m.label}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="min-w-0">
                {s.layout === "statement" && rest.length === 1 ? (
                  <p className="leading-snug" style={{ color: INK2, fontSize: size(2.6, 15) }}>
                    {rest[0].text}
                  </p>
                ) : (
                  rest.slice(0, 6).map((i) =>
                    i.kind === "gap" ? (
                      <button
                        key={i.block}
                        type="button"
                        onClick={onFillGap}
                        disabled={!onFillGap}
                        className="press flex w-full items-start text-left"
                        style={{ background: "#FFF6E0", borderLeft: "0.35cqw solid #E0B44C", padding: "1cqw 1.4cqw", marginBottom: "1.2cqw", color: INK2, fontSize: size(1.6, 12), gap: "1cqw" }}
                      >
                        <PenLine aria-hidden className="shrink-0" style={{ width: size(1.8, 13), height: size(1.8, 13), marginTop: "0.2cqw" }} />
                        <span className="min-w-0">
                          {i.text}
                          {i.label ? <span style={{ color: MUTED }}> — {i.label}</span> : null}
                        </span>
                      </button>
                    ) : i.kind === "point" ? (
                      <p key={i.block} className="flex leading-snug" style={{ color: INK2, fontSize: size(1.9, 13), marginBottom: "1.2cqw", gap: "1.4cqw" }}>
                        <span aria-hidden style={{ color: ACCENT }}>
                          •
                        </span>
                        <span className="min-w-0">{i.text}</span>
                      </p>
                    ) : (
                      <p key={i.block} className="leading-snug" style={{ color: INK, fontSize: size(1.9, 13), marginBottom: "1.2cqw" }}>
                        {i.text}
                      </p>
                    ),
                  )
                )}
              </div>
            </div>
            <div className="absolute flex justify-between" style={{ left: "6cqw", right: "6cqw", bottom: "max(2.2cqw, 10px)", borderTop: "1px solid #E3E5E1", paddingTop: "0.8cqw", color: MUTED, fontSize: size(1.05, 9) }}>
              <span className="truncate">{brand}</span>
              <span>
                {n + 1} / {slides.length}
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
