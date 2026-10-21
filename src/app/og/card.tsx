import { ImageResponse } from "next/og";

/*
 * The brand share card for articles and listings, drawn at request time with next/og (the
 * bundled Geist face; no font is fetched). Same composition as the site card: the near-empty
 * field with one faint trail glow, one floating white pane, the scout mark and the words.
 */

export const OG_SIZE = { width: 1200, height: 630 };

const INK = "#121614";
const INK_3 = "#626A65";
const INK_4 = "#868E89";
const ACCENT_TEXT = "#B8411F";
const PINE = "#1E5A48";
const CHEVRON = "M6.5 7 L16.5 16 L6.5 25";

/** Cuts at a word boundary and marks the cut, so the card never ends mid-word. */
export function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const head = t.slice(0, max);
  const cut = head.lastIndexOf(" ");
  return `${(cut > max * 0.6 ? head.slice(0, cut) : head).replace(/[,;:.\-–]+$/, "")}…`;
}

export function ogCard({ eyebrow, title, subtitle, badge }: { eyebrow: string; title: string; subtitle?: string | null; badge?: string | null }) {
  const t = clip(title, 110);
  const titleSize = t.length > 80 ? 54 : t.length > 52 ? 62 : 72;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: "radial-gradient(900px 520px at 92% 112%, rgba(228,87,46,0.16), transparent 60%), #F5F4F0",
          padding: 52,
        }}
      >
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            borderRadius: 44,
            background: "#FFFFFF",
            padding: "52px 60px",
            boxShadow: "0 0 0 2px rgba(18,22,20,0.08), 0 40px 80px -36px rgba(18,22,20,0.35)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 24 }}>
            <div style={{ display: "flex", fontSize: 22, letterSpacing: 3, textTransform: "uppercase", color: ACCENT_TEXT }}>{clip(eyebrow, 48)}</div>
            {badge ? (
              <div
                style={{
                  display: "flex",
                  fontSize: 22,
                  color: PINE,
                  background: "rgba(30,90,72,0.1)",
                  borderRadius: 999,
                  padding: "8px 20px",
                }}
              >
                {clip(badge, 40)}
              </div>
            ) : null}
          </div>
          <div style={{ display: "flex", marginTop: 30, fontSize: titleSize, lineHeight: 1.06, letterSpacing: -2, color: INK }}>{t}</div>
          {subtitle ? <div style={{ display: "flex", marginTop: 22, fontSize: 28, lineHeight: 1.35, color: INK_3 }}>{clip(subtitle, 130)}</div> : null}
          <div style={{ display: "flex", marginTop: "auto", alignItems: "center", gap: 14 }}>
            <svg width="46" height="46" viewBox="0 0 32 32">
              <path d={CHEVRON} fill="none" stroke={INK} strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="25.5" cy="16" r="3.25" fill={PINE} />
            </svg>
            <div style={{ display: "flex", fontSize: 32, color: INK, letterSpacing: -1 }}>Onward Scout</div>
            <div style={{ display: "flex", marginLeft: "auto", fontSize: 22, color: INK_4 }}>onwardscout.com</div>
          </div>
        </div>
      </div>
    ),
    { ...OG_SIZE, headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800" } },
  );
}
