/*
 * IndexNow key file (keyLocation = https://onwardscout.com/indexnow.txt; scripts/indexnow.mjs
 * pings with it). Read at request time, not at build: a build environment may not carry the key
 * (or may carry a placeholder for a sensitive variable), and a wrong key file makes every ping fail.
 * The CDN keeps the answer for a day.
 */

export const dynamic = "force-dynamic";

const KEY_RE = /^[A-Za-z0-9-]{8,128}$/;

export function GET() {
  const key = process.env.INDEXNOW_KEY?.trim() ?? "";
  if (!KEY_RE.test(key)) {
    return new Response("not configured", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  }
  return new Response(key, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600, s-maxage=86400" },
  });
}
