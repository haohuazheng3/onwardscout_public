export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// EU + EEA + UK + Switzerland: analytics need opt-in consent there.
const OPT_IN = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL",
  "PL", "PT", "RO", "SK", "SI", "ES", "SE", "IS", "LI", "NO", "GB", "CH",
]);

/** Region-aware consent for src/components/Consent.tsx (FlowGlance). */
export async function GET(req: Request) {
  const country = req.headers.get("x-vercel-ip-country")?.toUpperCase() ?? "";
  // Unknown location (local dev, privacy relays) is treated as opt-in: the conservative default.
  const consentRequired = !country || OPT_IN.has(country);
  return Response.json({ consentRequired, country: country || null }, { headers: { "Cache-Control": "private, no-store" } });
}
