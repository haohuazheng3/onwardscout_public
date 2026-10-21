import { Document, Font, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import type { GeneratedBlock, GeneratedDocumentKind } from "@/lib/core/types";
import { isGapBlock } from "./content";
import type { CjkFontFiles } from "./fonts";
import { CjkFontUnavailableError, needsExtendedFont } from "./glyphs";

export { CjkFontUnavailableError, needsExtendedFont };

/*
 * PDF layouts with @react-pdf/renderer. Four looks, all quiet and professional (the person's
 * document, so no Onward Scout branding on the page):
 *   letter   — cover letters, emails, statements, proposals, bios, answers, checklists;
 *   resume   — name, contact line, ruled sections, entry rows with dates on the right;
 *   onepager — title band and compact sections (one-pagers, pitch notes);
 * Latin text uses the built-in Helvetica. Chinese (and any glyph outside WinAnsi) falls back per
 * glyph to Noto Sans SC when the caller supplies it (fonts.ts); without it, such a document
 * throws `CjkFontUnavailableError` and the caller serves DOCX instead.
 */

export interface PdfInput {
  kind: GeneratedDocumentKind;
  title: string;
  language: string;
  blocks: GeneratedBlock[];
  /** Block roles from the composer (greeting, signature…), by index; optional. */
  roles?: string[];
  /** Shown as the PDF author. */
  personName?: string | null;
  /** Letter date; defaults to today. */
  date?: Date;
}

const CJK_FAMILY = "NotoSansSC";
let cjkRegistered: string | null = null;
let hyphenationSet = false;

const CJK_CHAR = /[⺀-鿿豈-﫿＀-￯　-〿]/;
const CLOSING = /^[，。、；：！？）」』”’》〉】,.;:!?)\]]$/;
const OPENING = /^[（「『“‘《〈【(\[]$/;

/**
 * Line-break opportunities inside Chinese runs. react-pdf only breaks at spaces (else it
 * hyphenates with a visible "-"), so a CJK "word" is split into characters separated by empty
 * syllables, which the line breaker treats as zero-width glue: clean breaks, no hyphen.
 * Closing punctuation stays with the character before it, opening punctuation with the one after.
 */
export function cjkSyllables(word: string): string[] {
  if (!CJK_CHAR.test(word)) return [word];
  const atoms = word.match(/[A-Za-z0-9%$€£¥.,+\-/#@&_]+|[\s\S]/gu) ?? [word];
  const groups: string[] = [];
  let pendingOpen = "";
  for (const a of atoms) {
    if (OPENING.test(a)) {
      pendingOpen += a;
      continue;
    }
    if (CLOSING.test(a) && groups.length && !pendingOpen) {
      groups[groups.length - 1] += a;
      continue;
    }
    groups.push(pendingOpen + a);
    pendingOpen = "";
  }
  if (pendingOpen) groups.push(pendingOpen);
  return groups.flatMap((g, i) => (i < groups.length - 1 ? [g, ""] : [g]));
}

function ensureSetup(cjk: CjkFontFiles | null): void {
  if (!hyphenationSet) {
    // Latin words are never hyphenated (cleaner letters); CJK runs get break opportunities.
    Font.registerHyphenationCallback((word) => cjkSyllables(word));
    hyphenationSet = true;
  }
  if (cjk && cjkRegistered !== cjk.regular) {
    Font.register({
      family: CJK_FAMILY,
      fonts: [
        { src: cjk.regular, fontWeight: 400 },
        { src: cjk.bold, fontWeight: 700 },
      ],
    });
    cjkRegistered = cjk.regular;
  }
}

const INK = "#121614";
const INK2 = "#3E4541";
const MUTED = "#626A65";
const LINE = "#D9DCD8";
const PINE = "#1E5A48";
const GAP_BG = "#FFF6E0";
const GAP_LINE = "#E0B44C";

function styles(family: string[] | string) {
  return StyleSheet.create({
    page: { paddingTop: 54, paddingBottom: 60, paddingHorizontal: 58, fontFamily: family, fontSize: 10.5, color: INK, lineHeight: 1.5 },
    // A résumé wants density: one page for most people.
    resumePage: { paddingTop: 40, paddingBottom: 44, paddingHorizontal: 50, fontFamily: family, fontSize: 9.8, color: INK, lineHeight: 1.4 },
    footer: { position: "absolute", bottom: 28, left: 58, right: 58, fontSize: 8, color: MUTED, textAlign: "right" },
    date: { fontSize: 10, color: MUTED, marginBottom: 18 },
    docTitle: { fontSize: 17, fontWeight: 700, color: INK, marginBottom: 14, lineHeight: 1.25 },
    heading: { fontSize: 11.5, fontWeight: 700, color: INK, marginTop: 12, marginBottom: 5, lineHeight: 1.3 },
    para: { marginBottom: 8 },
    greeting: { marginBottom: 10 },
    signature: { marginTop: 14 },
    bulletRow: { flexDirection: "row", marginBottom: 4, paddingLeft: 4 },
    bulletDot: { width: 12, color: INK2 },
    bulletText: { flex: 1 },
    fieldLabel: { fontSize: 9, fontWeight: 700, color: MUTED, marginTop: 6, marginBottom: 2, letterSpacing: 0.2 },
    fieldText: { marginBottom: 8 },
    gap: { backgroundColor: GAP_BG, borderLeftWidth: 2, borderLeftColor: GAP_LINE, paddingVertical: 5, paddingHorizontal: 8, marginBottom: 8, color: INK2 },
    // résumé
    rName: { fontSize: 21, fontWeight: 700, color: INK, lineHeight: 1.2 },
    rHeadline: { fontSize: 11, color: INK2, marginTop: 3 },
    rContact: { fontSize: 9, color: MUTED, marginTop: 4 },
    rSection: { fontSize: 9.2, fontWeight: 700, color: PINE, letterSpacing: 1.1, marginTop: 11, paddingBottom: 2.5, marginBottom: 5, borderBottomWidth: 0.7, borderBottomColor: LINE },
    rEntry: { flexDirection: "row", justifyContent: "space-between", marginTop: 4, marginBottom: 2 },
    rEntryLabel: { fontWeight: 700, flex: 1, paddingRight: 10 },
    rEntryWhen: { fontSize: 9, color: MUTED, textAlign: "right", maxWidth: 190 },
    rBullet: { flexDirection: "row", marginBottom: 2.5, paddingLeft: 2 },
    rPara: { marginBottom: 4 },
    // one-pager
    band: { borderBottomWidth: 2, borderBottomColor: PINE, paddingBottom: 8, marginBottom: 12 },
    bandTitle: { fontSize: 19, fontWeight: 700, color: INK, lineHeight: 1.2 },
    oHeading: { fontSize: 10, fontWeight: 700, color: PINE, letterSpacing: 0.8, marginTop: 10, marginBottom: 4 },
  });
}

type Styles = ReturnType<typeof styles>;

function layoutOf(kind: GeneratedDocumentKind): "letter" | "resume" | "onepager" {
  if (kind === "resume_variant") return "resume";
  if (kind === "one_pager" || kind === "pitch_notes") return "onepager";
  return "letter";
}

function formatDate(d: Date, language: string): string {
  if (language.startsWith("zh")) return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

function Gap({ b, s }: { b: GeneratedBlock; s: Styles }) {
  return (
    <View style={s.gap} wrap={false}>
      <Text>{b.text}</Text>
    </View>
  );
}

function LetterBody({ input, s }: { input: PdfInput; s: Styles }) {
  const showTitle = input.kind !== "cover_letter" && input.kind !== "email";
  return (
    <>
      {input.kind === "cover_letter" ? <Text style={s.date}>{formatDate(input.date ?? new Date(), input.language)}</Text> : null}
      {showTitle ? <Text style={s.docTitle}>{input.title}</Text> : null}
      {input.blocks.map((b, i) => {
        const role = input.roles?.[i];
        if (isGapBlock(b)) return <Gap key={i} b={b} s={s} />;
        if (role === "subject" || (b.type === "field" && input.kind === "email" && i === 0)) {
          return (
            <Text key={i} style={s.docTitle}>
              {b.text}
            </Text>
          );
        }
        switch (b.type) {
          case "heading":
            return (
              <Text key={i} style={s.heading} minPresenceAhead={40}>
                {b.text}
              </Text>
            );
          case "bullet":
            return (
              <View key={i} style={s.bulletRow} wrap={false}>
                <Text style={s.bulletDot}>•</Text>
                <Text style={s.bulletText}>{b.text}</Text>
              </View>
            );
          case "field":
            return (
              <View key={i} wrap={false}>
                {b.label ? <Text style={s.fieldLabel}>{b.label}</Text> : null}
                <Text style={s.fieldText}>{b.text}</Text>
              </View>
            );
          default:
            return (
              <Text key={i} style={role === "greeting" ? s.greeting : role === "signature" ? s.signature : s.para}>
                {b.text}
              </Text>
            );
        }
      })}
    </>
  );
}

function ResumeBody({ input, s }: { input: PdfInput; s: Styles }) {
  const roles = input.roles ?? [];
  return (
    <>
      {input.blocks.map((b, i) => {
        const role = roles[i];
        if (isGapBlock(b)) return <Gap key={i} b={b} s={s} />;
        if (b.type === "heading" && i === 0) {
          return (
            <Text key={i} style={s.rName}>
              {b.text}
            </Text>
          );
        }
        if (role === "context-line")
          return (
            <Text key={i} style={s.rHeadline}>
              {b.text}
            </Text>
          );
        if (role === "contact")
          return (
            <Text key={i} style={s.rContact}>
              {b.text}
            </Text>
          );
        switch (b.type) {
          case "heading":
            return (
              <Text key={i} style={s.rSection} minPresenceAhead={36}>
                {input.language.startsWith("zh") ? b.text : b.text.toUpperCase()}
              </Text>
            );
          case "field":
            return (
              <View key={i} style={s.rEntry} wrap={false} minPresenceAhead={24}>
                <Text style={s.rEntryLabel}>{b.label ?? ""}</Text>
                {b.text ? <Text style={s.rEntryWhen}>{b.text}</Text> : null}
              </View>
            );
          case "bullet":
            return (
              <View key={i} style={s.rBullet} wrap={false}>
                <Text style={s.bulletDot}>•</Text>
                <Text style={s.bulletText}>{b.text}</Text>
              </View>
            );
          default:
            return (
              <Text key={i} style={s.rPara}>
                {b.text}
              </Text>
            );
        }
      })}
    </>
  );
}

function OnePagerBody({ input, s }: { input: PdfInput; s: Styles }) {
  return (
    <>
      <View style={s.band}>
        <Text style={s.bandTitle}>{input.title}</Text>
      </View>
      {input.blocks.map((b, i) => {
        if (isGapBlock(b)) return <Gap key={i} b={b} s={s} />;
        switch (b.type) {
          case "heading":
            return (
              <Text key={i} style={s.oHeading} minPresenceAhead={30}>
                {input.language.startsWith("zh") ? b.text : b.text.toUpperCase()}
              </Text>
            );
          case "bullet":
            return (
              <View key={i} style={s.bulletRow} wrap={false}>
                <Text style={s.bulletDot}>•</Text>
                <Text style={s.bulletText}>{b.text}</Text>
              </View>
            );
          case "field":
            return (
              <View key={i} wrap={false}>
                {b.label ? <Text style={s.fieldLabel}>{b.label}</Text> : null}
                <Text style={s.fieldText}>{b.text}</Text>
              </View>
            );
          default:
            return (
              <Text key={i} style={s.para}>
                {b.text}
              </Text>
            );
        }
      })}
    </>
  );
}

/** Renders a document to PDF bytes. Pass `cjk` (from `loadCjkFonts`) when the text needs it. */
export async function renderPdf(input: PdfInput, opts: { cjk?: CjkFontFiles | null } = {}): Promise<Uint8Array> {
  const texts = [input.title, ...input.blocks.flatMap((b) => [b.text, b.label ?? ""])];
  const extended = needsExtendedFont(texts);
  const cjk = opts.cjk ?? null;
  if (extended && !cjk) throw new CjkFontUnavailableError();
  ensureSetup(cjk);
  const family = cjk ? ["Helvetica", CJK_FAMILY] : "Helvetica";
  const s = styles(family);
  const layout = layoutOf(input.kind);
  const zh = input.language.startsWith("zh");
  const doc = (
    <Document title={input.title} author={input.personName ?? undefined} creator="Onward Scout" producer="Onward Scout" language={zh ? "zh-CN" : "en"}>
      <Page size="A4" style={layout === "resume" ? s.resumePage : s.page} wrap>
        {layout === "resume" ? <ResumeBody input={input} s={s} /> : layout === "onepager" ? <OnePagerBody input={input} s={s} /> : <LetterBody input={input} s={s} />}
        <Text style={s.footer} fixed render={({ pageNumber, totalPages }) => (totalPages > 1 ? `${pageNumber} / ${totalPages}` : "")} />
      </Page>
    </Document>
  );
  const buf = await renderToBuffer(doc);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}
