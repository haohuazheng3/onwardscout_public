import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";

/*
 * The site-wide social card (/opengraph-image, the default image of pageMetadata()). The
 * artwork is public/brand/og-default.png, rendered by scripts/gen-icons.mjs from the logo
 * geometry with the brand display face outlined (no runtime font loading). This route is
 * static: it reads the file once at build time and is served from the CDN.
 */

// Rendered once at build time and served from the CDN.
export const dynamic = "force-static";

export const alt = "Onward Scout — your scout for every opportunity.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const CHEVRON = "M6.5 7 L16.5 16 L6.5 25";

export default async function Image() {
  try {
    const png = await readFile(path.join(process.cwd(), "public", "brand", "og-default.png"));
    return new Response(new Uint8Array(png), {
      headers: { "Content-Type": contentType, "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800" },
    });
  } catch (error) {
    console.error("[og] public/brand/og-default.png unreadable; drawing the fallback card", error);
  }

  // Fallback: the same composition, drawn with the default font (no external font needed).
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#F5F4F0", padding: 56 }}>
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            borderRadius: 44,
            background: "#FFFFFF",
            padding: "56px 64px",
            boxShadow: "0 0 0 2px rgba(18,22,20,0.08), 0 40px 80px -36px rgba(18,22,20,0.35)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <svg width="56" height="56" viewBox="0 0 32 32">
              <path d={CHEVRON} fill="none" stroke="#121614" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="25.5" cy="16" r="3.25" fill="#1E5A48" />
            </svg>
            <div style={{ display: "flex", fontSize: 34, color: "#121614", letterSpacing: -1 }}>Onward Scout</div>
          </div>
          <div style={{ display: "flex", fontSize: 76, lineHeight: 1.02, color: "#121614", letterSpacing: -3, maxWidth: 900 }}>
            Your scout for every opportunity.
          </div>
          <div style={{ display: "flex", fontSize: 28, color: "#626A65" }}>
            Drop in what you have. Tap what you want. We prepare, submit and follow up.
          </div>
        </div>
      </div>
    ),
    size,
  );
}
