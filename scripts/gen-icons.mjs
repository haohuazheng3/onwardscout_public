#!/usr/bin/env node
// Generates every brand asset from ONE source: the mark geometry exported by
// src/components/Logo.tsx (MARK_CHEVRON, MARK_STROKE, MARK_DOT), parsed out of that file.
//
//   node scripts/gen-icons.mjs        (npm run icons)
//
// Writes:
//   src/app/icon.svg                 favicon for modern browsers (follows light/dark itself)
//   src/app/favicon.ico              16/32/48 px PNG-in-ICO fallback
//   src/app/apple-icon.png           180 px, full bleed (iOS rounds the corners)
//   public/brand/logo-{512,256,192}.png   app icon (white pane tile), also the schema.org logo
//   public/brand/icon-maskable-512.png    full-bleed tile, mark inside the 80% safe zone
//   public/brand/mark.svg | mark-mono.svg | mark-light.svg
//   public/brand/wordmark.svg | wordmark-light.svg   (text outlined: no font needed to view)
//   public/brand/og-default.png      1200×630 social card (served by src/app/opengraph-image.tsx)
//
// Text is outlined with fontkit (a dependency of @react-pdf/renderer). Fonts come from
// BRAND_FONTS_DIR, else from next/font's download cache (.next/**/static/media/*.woff2 —
// run `next dev` or `next build` once), else Geist Regular bundled with next/og.
import { Resvg } from "@resvg/resvg-js";
import * as fontkit from "fontkit";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = (p) => path.join(root, p);

/* ------------------------------------------------------------------ geometry (from Logo.tsx) */

const logoSrc = fs.readFileSync(out("src/components/Logo.tsx"), "utf8");
const CHEVRON = /export const MARK_CHEVRON = "([^"]+)"/.exec(logoSrc)?.[1];
const STROKE = Number(/export const MARK_STROKE = ([\d.]+)/.exec(logoSrc)?.[1]);
const dotMatch = /export const MARK_DOT = \{ cx: ([\d.]+), cy: ([\d.]+), r: ([\d.]+) \}/.exec(logoSrc);
if (!CHEVRON || !Number.isFinite(STROKE) || !dotMatch) throw new Error("Could not read MARK_CHEVRON / MARK_STROKE / MARK_DOT from src/components/Logo.tsx");
const DOT = { cx: Number(dotMatch[1]), cy: Number(dotMatch[2]), r: Number(dotMatch[3]) };

/* ------------------------------------------------------------------ palette (globals.css tokens) */

const C = {
  void: "#F5F4F0",
  pane: "#FFFFFF",
  pane2: "#F8F7F3",
  pane3: "#F0EEE8",
  ink: "#121614",
  ink2: "#3E4541",
  ink3: "#626A65",
  ink4: "#868E89",
  inkPane: "#121614",
  accent: "#E4572E",
  accentDark: "#FF7A50",
  accentText: "#B8411F",
  accentTextDark: "#FF9A78",
  pine: "#1E5A48",
  pineLight: "#5FC2A0",
  light: "#F2F4F1",
  darkPane: "#161B18",
  line: "rgba(18,22,20,0.10)",
};

const mark = (chevron, dot) =>
  `<path d="${CHEVRON}" fill="none" stroke="${chevron}" stroke-width="${STROKE}" stroke-linecap="round" stroke-linejoin="round"/>` +
  `<circle cx="${DOT.cx}" cy="${DOT.cy}" r="${DOT.r}" fill="${dot}"/>`;

/** The mark scaled into a box at (x, y) of `size` px. */
const markAt = (x, y, size, chevron = C.ink, dot = C.pine) => `<g transform="translate(${x} ${y}) scale(${size / 32})">${mark(chevron, dot)}</g>`;

/* ------------------------------------------------------------------ fonts */

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, acc);
    else if (/\.(woff2?|ttf|otf)$/.test(entry.name)) acc.push(p);
  }
  return acc;
}

function findFont(family) {
  const dirs = [process.env.BRAND_FONTS_DIR, out(".next")].filter(Boolean);
  for (const dir of dirs) {
    for (const file of walk(dir)) {
      try {
        const f = fontkit.openSync(file);
        if (f.familyName?.startsWith(family) && f.hasGlyphForCodePoint(0x4f) && f.hasGlyphForCodePoint(0x2019)) return { font: f, file };
      } catch {
        /* not a font fontkit reads: skip */
      }
    }
  }
  return null;
}

const fallbackFile = out("node_modules/next/dist/compiled/@vercel/og/Geist-Regular.ttf");
const display = findFont("Bricolage Grotesque");
const ui = findFont("Geist");
const fallback = { font: fontkit.openSync(fallbackFile), file: fallbackFile };
console.log(`display font: ${display ? path.relative(root, display.file) : "fallback (Geist Regular)"}`);
console.log(`ui font:      ${ui ? path.relative(root, ui.file) : "fallback (Geist Regular)"}`);

const variants = new Map();

/**
 * The font at the requested axis values (wght/opsz/wdth). fontkit applies gvar deltas while
 * decoding TrueType glyphs, but a WOFF2 font's glyphs are pre-decoded without them (and its
 * getVariation() cannot read WOFF2 at all), so for WOFF2 the deltas are applied here: the
 * default-instance glyphs are copied into a second reader whose variation coordinates are set,
 * each glyph's points (plus the four phantom points) pushed through its variation processor.
 * Advances follow HVAR. Composite glyph offsets keep their default positions (none of the
 * brand strings use composites at sizes where that would show).
 */
function variant(entry, axes) {
  const f = entry.font;
  if (!f.variationAxes || Object.keys(f.variationAxes).length === 0) return f;
  const coords = f.fvar.axis.map((axis) => {
    const tag = axis.axisTag.trim();
    return tag in axes ? Math.max(axis.minValue, Math.min(axis.maxValue, axes[tag])) : axis.defaultValue;
  });
  const key = `${entry.file}|${coords.join(",")}`;
  const hit = variants.get(key);
  if (hit) return hit;

  let v;
  if (f.type !== "WOFF2") {
    v = f.getVariation(Object.fromEntries(f.fvar.axis.map((a, i) => [a.axisTag.trim(), coords[i]])));
  } else {
    const base = fontkit.openSync(entry.file);
    base.layout("A"); // decodes (untransformed) glyf data into base._transformedGlyphs
    v = fontkit.openSync(entry.file);
    v.variationCoords = coords;
    const proc = v._variationProcessor;
    const os2 = v["OS/2"];
    const metrics = v.hmtx.metrics;
    v._transformedGlyphs = base._transformedGlyphs.map((g, id) => {
      if (!g || !g.points) return g;
      const pts = g.points.map((p) => p.copy());
      if (pts.length === 0) return g;
      const Point = pts[0].constructor;
      const m = metrics.get(Math.min(id, metrics.length - 1));
      const xMin = Math.min(...pts.map((p) => p.x));
      const yMax = Math.max(...pts.map((p) => p.y));
      const ah = Math.abs(os2.typoAscender - os2.typoDescender);
      const tb = os2.typoAscender - yMax;
      const all = pts.concat([
        new Point(false, true, xMin - m.bearing, 0),
        new Point(false, true, xMin - m.bearing + m.advance, 0),
        new Point(false, true, 0, yMax + tb),
        new Point(false, true, 0, yMax + tb + ah),
      ]);
      proc.transformPoints(id, all);
      return { ...g, points: all.slice(0, pts.length), phantomPoints: all.slice(-4) };
    });
  }
  variants.set(key, v);
  return v;
}

/**
 * Outlined text: returns { svg, width } for `str` with its baseline at (x, y).
 * kind "display" = Bricolage Grotesque (wght/opsz/wdth), "ui" = Geist (wght).
 */
function text(str, { kind = "ui", size, x, y, fill, weight = 500, opsz = 96, wdth = 100, tracking = 0 }) {
  const entry = kind === "display" ? (display ?? ui ?? fallback) : (ui ?? fallback);
  const font = variant(entry, kind === "display" ? { wght: weight, opsz, wdth } : { wght: weight });
  const run = font.layout(str);
  const scale = size / font.unitsPerEm;
  let pen = 0;
  const parts = [];
  run.glyphs.forEach((g, i) => {
    const pos = run.positions[i];
    const d = g.path
      .scale(scale, -scale)
      .translate(x + pen + pos.xOffset * scale, y - pos.yOffset * scale)
      .toSVG();
    if (d) parts.push(d);
    pen += pos.xAdvance * scale + tracking * size;
  });
  const width = pen - tracking * size;
  return { svg: `<path fill="${fill}" d="${parts.join(" ")}"/>`, width };
}

/** Cap height of the display face in px at `size`. */
function capHeight(size) {
  const f = (display ?? ui ?? fallback).font;
  return ((f.capHeight || f.unitsPerEm * 0.7) / f.unitsPerEm) * size;
}

/* ------------------------------------------------------------------ rendering */

function png(svg, width) {
  return new Resvg(svg, { fitTo: { mode: "width", value: width }, font: { loadSystemFonts: false } }).render().asPng();
}

function write(rel, data) {
  const p = out(rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, data);
  console.log(`  ${rel}  (${typeof data === "string" ? Buffer.byteLength(data) : data.length} bytes)`);
}

/** App icon tile: a white pane with a hairline, the mark centered (optically: it leans right by design). */
function tile({ size = 512, radius = 0.225, pad = 0.2, bg = C.pane, ring = true, chevron = C.ink, dot = C.pine } = {}) {
  const inner = size * (1 - pad * 2);
  const off = (size - inner) / 2;
  const nudge = -size * 0.008; // the dot sits right of centre; pull the whole mark back a hair
  const r = size * radius;
  const ringW = Math.max(1, size / 256);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<rect width="${size}" height="${size}" rx="${r}" fill="${bg}"/>` +
    (ring ? `<rect x="${ringW / 2}" y="${ringW / 2}" width="${size - ringW}" height="${size - ringW}" rx="${r - ringW / 2}" fill="none" stroke="${C.line}" stroke-width="${ringW}"/>` : "") +
    markAt(off + nudge, off, inner, chevron, dot) +
    `</svg>`;
}

console.log("brand assets:");

// 1. Favicon SVG that follows the browser's colour scheme.
write(
  "src/app/icon.svg",
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<style>.t{fill:${C.pane};stroke:rgba(18,22,20,.14)}.c{stroke:${C.ink}}.d{fill:${C.pine}}` +
    `@media (prefers-color-scheme:dark){.t{fill:${C.darkPane};stroke:rgba(242,244,241,.18)}.c{stroke:${C.light}}.d{fill:${C.pineLight}}}</style>` +
    `<rect class="t" x="1" y="1" width="62" height="62" rx="15" stroke-width="2"/>` +
    `<g transform="translate(7.5 8) scale(${48 / 32})"><path class="c" d="${CHEVRON}" fill="none" stroke-width="${STROKE}" stroke-linecap="round" stroke-linejoin="round"/><circle class="d" cx="${DOT.cx}" cy="${DOT.cy}" r="${DOT.r}"/></g>` +
    `</svg>\n`,
);

// 2. favicon.ico: PNG entries; the 16 px one gets a larger mark so it still reads.
{
  const sizes = [16, 32, 48];
  const images = sizes.map((s) => png(tile({ size: 64, radius: 0.24, pad: s <= 16 ? 0.08 : 0.13, ring: s > 16 }), s));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const dir = images.map((buf, i) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(sizes[i], 0);
    e.writeUInt8(sizes[i], 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(buf.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += buf.length;
    return e;
  });
  write("src/app/favicon.ico", Buffer.concat([header, ...dir, ...images]));
}

// 3. Apple touch icon: full bleed, iOS applies its own mask.
write("src/app/apple-icon.png", png(tile({ size: 180, radius: 0, pad: 0.2, ring: false }), 180));

// 4. App icons / schema.org logo.
for (const s of [512, 256, 192]) write(`public/brand/logo-${s}.png`, png(tile({ size: 512 }), s));
write("public/brand/icon-maskable-512.png", png(tile({ size: 512, radius: 0, pad: 0.27, ring: false }), 512));

// 5. Vector marks.
write("public/brand/mark.svg", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${mark(C.ink, C.pine)}</svg>\n`);
write("public/brand/mark-mono.svg", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${mark(C.ink, C.ink)}</svg>\n`);
write("public/brand/mark-light.svg", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${mark(C.light, C.pineLight)}</svg>\n`);

// 6. Wordmark: mark + "Onward Scout", outlined.
function wordmark({ chevron, dot, ink }) {
  const H = 48;
  const size = 34;
  const label = text("Onward Scout", { kind: "display", size, x: 0, y: 0, fill: ink, weight: 700, opsz: 32, wdth: 92, tracking: -0.03 });
  const markSize = 44;
  const gap = 5; // the mark carries ~3 units of air on its right already
  const baseline = H / 2 + capHeight(size) / 2;
  const t = text("Onward Scout", { kind: "display", size, x: markSize + gap, y: baseline, fill: ink, weight: 700, opsz: 32, wdth: 92, tracking: -0.03 });
  const W = Math.ceil(markSize + gap + label.width + 2);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${markAt(0, (H - markSize) / 2, markSize, chevron, dot)}${t.svg}</svg>\n`;
}
write("public/brand/wordmark.svg", wordmark({ chevron: C.ink, dot: C.pine, ink: C.ink }));
write("public/brand/wordmark-light.svg", wordmark({ chevron: C.light, dot: C.pineLight, ink: C.light }));

/**
 * Layered soft shadow as an SVG filter (resvg renders feDropShadow with a light seam, so the
 * shadow is built from blurred alpha + flood + merge, in sRGB). layers: [dy, blur, opacity].
 */
function shadowFilter(id, layers) {
  const parts = layers
    .map(
      ([dy, blur, op], i) =>
        `<feGaussianBlur in="SourceAlpha" stdDeviation="${blur}"/><feOffset dy="${dy}" result="o${i}"/>` +
        `<feFlood flood-color="#121614" flood-opacity="${op}"/><feComposite in2="o${i}" operator="in" result="s${i}"/>`,
    )
    .join("");
  const merge = layers.map((_, i) => `<feMergeNode in="s${i}"/>`).join("");
  return `<filter id="${id}" filterUnits="userSpaceOnUse" x="0" y="0" width="1200" height="630" color-interpolation-filters="sRGB">${parts}<feMerge>${merge}<feMergeNode in="SourceGraphic"/></feMerge></filter>`;
}

// 7. Social card: the empty field, one trail of light, the floating panes.
function ogCard() {
  const W = 1200;
  const H = 630;
  const parts = [];
  const defs = `
  <defs>
    <radialGradient id="blaze" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${C.accent}" stop-opacity="0.22"/><stop offset="1" stop-color="${C.accent}" stop-opacity="0"/></radialGradient>
    <radialGradient id="pine" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${C.pine}" stop-opacity="0.16"/><stop offset="1" stop-color="${C.pine}" stop-opacity="0"/></radialGradient>
    <radialGradient id="inkglow" cx="1" cy="0" r="1"><stop offset="0" stop-color="${C.accentDark}" stop-opacity="0.22"/><stop offset="0.6" stop-color="${C.accentDark}" stop-opacity="0"/></radialGradient>
    <filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 0.07  0 0 0 0 0.09  0 0 0 0 0.08  0 0 0 0.9 0"/></filter>
    ${shadowFilter("float", [
      [2, 2, 0.07],
      [26, 26, 0.15],
      [60, 50, 0.11],
    ])}
    ${shadowFilter("floatInk", [
      [4, 4, 0.2],
      [30, 30, 0.34],
    ])}
  </defs>`;
  parts.push(`<rect width="${W}" height="${H}" fill="${C.void}"/>`);
  // The trail: pine where it began (lower left), blaze where it is heading (upper right).
  parts.push(
    `<g transform="rotate(-21 600 315)"><ellipse cx="300" cy="360" rx="470" ry="150" fill="url(#pine)"/><ellipse cx="880" cy="300" rx="520" ry="190" fill="url(#blaze)"/></g>`,
  );
  parts.push(`<rect width="${W}" height="${H}" filter="url(#grain)" opacity="0.05"/>`);

  // Main pane.
  const px = 56;
  const py = 56;
  const pw = 704;
  const ph = 518;
  parts.push(`<rect x="${px}" y="${py}" width="${pw}" height="${ph}" rx="40" fill="${C.pane}" filter="url(#float)"/>`);
  parts.push(`<rect x="${px + 0.5}" y="${py + 0.5}" width="${pw - 1}" height="${ph - 1}" rx="39.5" fill="none" stroke="${C.line}"/>`);
  const left = px + 56;
  parts.push(markAt(left, py + 48, 40));
  parts.push(text("Onward Scout", { kind: "display", size: 30, x: left + 50, y: py + 78, fill: C.ink, weight: 700, opsz: 32, wdth: 92, tracking: -0.03 }).svg);
  const h1 = { kind: "display", size: 78, fill: C.ink, weight: 720, opsz: 96, wdth: 88, tracking: -0.022 };
  parts.push(text("Your scout for", { ...h1, x: left - 3, y: py + 220 }).svg);
  const every = text("every ", { ...h1, x: left - 3, y: py + 300 });
  parts.push(every.svg);
  parts.push(text("opportunity.", { ...h1, x: left - 3 + every.width - 0.022 * 78, y: py + 300, fill: C.accentText }).svg);
  const dek = { kind: "ui", size: 25, fill: C.ink3, weight: 450 };
  parts.push(text("Drop in what you have. Tap the openings you want.", { ...dek, x: left, y: py + 382 }).svg);
  parts.push(text("We prepare, submit after your tap, and follow up.", { ...dek, x: left, y: py + 418 }).svg);
  parts.push(`<circle cx="${left + 6}" cy="${py + ph - 58}" r="6" fill="${C.pine}"/>`);
  parts.push(text("onwardscout.com", { kind: "ui", size: 22, x: left + 22, y: py + ph - 50, fill: C.ink2, weight: 560 }).svg);

  // Floating card A — a match, ready to confirm (generic, illustrative UI; no real program named).
  const ax = 800;
  const ay = 92;
  const aw = 348;
  const ah = 178;
  parts.push(`<rect x="${ax}" y="${ay}" width="${aw}" height="${ah}" rx="28" fill="${C.pane}" filter="url(#float)"/>`);
  parts.push(`<rect x="${ax + 0.5}" y="${ay + 0.5}" width="${aw - 1}" height="${ah - 1}" rx="27.5" fill="none" stroke="${C.line}"/>`);
  const tagA = text("Fellowship", { kind: "ui", size: 15, x: ax + 38, y: ay + 47, fill: C.ink2, weight: 600 });
  parts.push(`<rect x="${ax + 26}" y="${ay + 26}" width="${tagA.width + 24}" height="30" rx="15" fill="${C.pane2}" stroke="${C.line}"/>`);
  parts.push(tagA.svg);
  parts.push(text("Research fellowship", { kind: "display", size: 26, x: ax + 26, y: ay + 96, fill: C.ink, weight: 660, opsz: 24, wdth: 96, tracking: -0.012 }).svg);
  parts.push(text("Why it fits: your two papers and lab role", { kind: "ui", size: 16, x: ax + 26, y: ay + 124, fill: C.ink3, weight: 450 }).svg);
  const okA = text("Ready to confirm", { kind: "ui", size: 15, x: ax + 52, y: ay + 158, fill: C.pine, weight: 620 });
  parts.push(`<rect x="${ax + 26}" y="${ay + 138}" width="${okA.width + 40}" height="28" rx="14" fill="rgba(30,90,72,0.12)"/>`);
  parts.push(`<circle cx="${ax + 40}" cy="${ay + 152}" r="4" fill="${C.pine}"/>`);
  parts.push(okA.svg);

  // Floating card B — the 30-second handoff, on an ink pane.
  const bx = 742;
  const by = 300;
  const bw = 404;
  const bh = 150;
  parts.push(`<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="28" fill="${C.inkPane}" filter="url(#floatInk)"/>`);
  parts.push(`<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="28" fill="url(#inkglow)"/>`);
  parts.push(`<rect x="${bx + 0.5}" y="${by + 0.5}" width="${bw - 1}" height="${bh - 1}" rx="27.5" fill="none" stroke="rgba(242,244,241,0.10)"/>`);
  const tagB = text("Needs you · 30 seconds", { kind: "ui", size: 15, x: bx + 52, y: by + 47, fill: C.accentTextDark, weight: 620 });
  parts.push(`<rect x="${bx + 26}" y="${by + 26}" width="${tagB.width + 40}" height="30" rx="15" fill="rgba(255,122,80,0.16)"/>`);
  parts.push(`<circle cx="${bx + 40}" cy="${by + 41}" r="4" fill="${C.accentDark}"/>`);
  parts.push(tagB.svg);
  parts.push(text("One CAPTCHA left. The rest is filled in.", { kind: "ui", size: 18, x: bx + 26, y: by + 92, fill: C.light, weight: 560 }).svg);
  const btn = text("Open the form", { kind: "ui", size: 15, x: bx + 44, y: by + 127, fill: C.ink, weight: 650 });
  parts.push(`<rect x="${bx + 26}" y="${by + 104}" width="${btn.width + 36}" height="34" rx="17" fill="${C.accentDark}"/>`);
  parts.push(btn.svg);

  // Floating card C — submitted.
  const cx = 820;
  const cy = 478;
  const cw = 328;
  const ch = 96;
  parts.push(`<rect x="${cx}" y="${cy}" width="${cw}" height="${ch}" rx="26" fill="${C.pane}" filter="url(#float)"/>`);
  parts.push(`<rect x="${cx + 0.5}" y="${cy + 0.5}" width="${cw - 1}" height="${ch - 1}" rx="25.5" fill="none" stroke="${C.line}"/>`);
  parts.push(`<circle cx="${cx + 46}" cy="${cy + 48}" r="20" fill="rgba(30,90,72,0.12)"/>`);
  parts.push(`<path d="M${cx + 37} ${cy + 48.5} l6.5 6.5 l12 -13" fill="none" stroke="${C.pine}" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>`);
  parts.push(text("Accelerator · Submitted", { kind: "ui", size: 18, x: cx + 80, y: cy + 44, fill: C.ink, weight: 600 }).svg);
  parts.push(text("Follow-up scheduled", { kind: "ui", size: 15, x: cx + 80, y: cy + 68, fill: C.ink3, weight: 450 }).svg);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${defs}${parts.join("")}</svg>`;
}
write("public/brand/og-default.png", png(ogCard(), 1200));

console.log("done.");
