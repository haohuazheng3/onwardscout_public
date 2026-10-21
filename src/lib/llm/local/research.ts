import { clip, collapse, findMoney, findUrls, isBulletLine, stripBullet, uniq } from "./text";

/*
 * Academic CV pieces: publication lists (APA/MLA/IEEE-ish and Chinese GB/T 7714-ish),
 * grants, h-index, ORCID iD. Citation formats vary wildly, so the parser keeps the raw
 * line as the quote and only fills the fields it can read with confidence.
 */

export interface PublicationEntry {
  title: string;
  authors: string[];
  venue: string | null;
  year: number | null;
  doi: string | null;
  url: string | null;
  /** journal | conference | preprint | book | chapter | patent | thesis | null */
  kind: string | null;
  /** published | accepted | under_review | in_preparation */
  status: string;
}

export const ORCID_RE = /\b(\d{4}-\d{4}-\d{4}-\d{3}[\dX])\b/;

/** Joins wrapped citation lines into one string per entry (entries start with a number, bullet, or "[n]"). */
export function splitCitations(sectionLines: string[]): string[] {
  const entries: string[] = [];
  const startRe = /^\s*(\[\d+\]|\d{1,3}[.)]|[•●▪◦*-])\s+/;
  const anyMarker = sectionLines.some((l) => startRe.test(l) || isBulletLine(l));
  for (const raw of sectionLines) {
    const line = raw.trim();
    if (!line) continue;
    // Sub-headings inside a publications section ("Journal Articles", "2024").
    if (/^(journal articles?|conference (papers|proceedings)|preprints?|books?|book chapters?|under review|in preparation|working papers?|期刊论文|会议论文)\s*:?$/i.test(line) || /^(19|20)\d{2}$/.test(line)) continue;
    if (!anyMarker) {
      entries.push(line);
      continue;
    }
    if (startRe.test(line) || isBulletLine(line) || entries.length === 0) entries.push(line.replace(startRe, "").replace(/^\s*\[\d+\]\s*/, ""));
    else entries[entries.length - 1] += ` ${line}`;
  }
  return entries.map((e) => stripBullet(collapse(e))).filter((e) => e.length >= 20);
}

function cleanTitle(s: string): string {
  return s
    .replace(/^["“”'‘’«»]+|["“”'‘’«»]+$/g, "")
    .replace(/[.。,，]+$/, "")
    .trim();
}

function guessKind(entry: string, venue: string | null): string | null {
  const t = `${entry} ${venue ?? ""}`;
  if (/arxiv|preprint|biorxiv|medrxiv|ssrn|under review|submitted/i.test(t)) return "preprint";
  if (/\bproc(eedings)?\b|conference|symposium|workshop|\bconf\.|neurips|icml|iclr|cvpr|iccv|eccv|acl|emnlp|naacl|chi\b|kdd|sigir|aaai|ijcai|会议/i.test(t)) return "conference";
  if (/\bpatent\b|专利/i.test(t)) return "patent";
  if (/\b(dissertation|thesis)\b|学位论文/i.test(t)) return "thesis";
  if (/\bin:?\s.*\(eds?\.?\)|book chapter|chapter in/i.test(t)) return "chapter";
  if (/\bpress\b|publishers?\b|出版社/i.test(t) && !/journal/i.test(t)) return "book";
  if (/journal|letters|review|transactions|quarterly|annals|bulletin|nature|science|cell|lancet|plos|学报|期刊|杂志/i.test(t)) return "journal";
  return null;
}

/** Parses one citation string. Returns null when it doesn't look like a publication. */
export function parseCitation(entry: string): PublicationEntry | null {
  const text = collapse(entry);
  const yearMatch = /\((19|20)\d{2}[a-z]?\)|\b(19|20)\d{2}\b/.exec(text);
  const year = yearMatch ? Number(yearMatch[0].replace(/[()a-z]/g, "")) : null;
  const doiMatch = /\b(10\.\d{4,9}\/[^\s,;]+[^\s.,;])/i.exec(text);
  const doi = doiMatch ? doiMatch[1] : null;
  const arxiv = /arxiv[:\s]*(\d{4}\.\d{4,5})/i.exec(text);
  const url = findUrls(text).find((u) => !/doi\.org/.test(u)) ?? (doi ? `https://doi.org/${doi}` : arxiv ? `https://arxiv.org/abs/${arxiv[1]}` : null);

  let title: string | null = null;
  let authorsPart = "";
  let venuePart = "";

  const quoted = /["“]([^"”]{8,300})["”]/.exec(text);
  const cnTitle = /^(.{2,80}?)[.．]\s*(.{4,200}?)\[[JCMDP]\]\s*[.．]?\s*(.*)$/.exec(text); // GB/T 7714: 作者. 题名[J]. 刊名, 年
  if (cnTitle) {
    authorsPart = cnTitle[1];
    title = cnTitle[2];
    venuePart = cnTitle[3];
  } else if (quoted) {
    title = quoted[1];
    authorsPart = text.slice(0, quoted.index).replace(/\(?(19|20)\d{2}[a-z]?\)?[.,]?\s*$/, "");
    venuePart = text.slice((quoted.index ?? 0) + quoted[0].length);
  } else if (yearMatch && /^\(/.test(yearMatch[0])) {
    // APA: Authors (Year). Title. Venue, vol(issue), pages.
    authorsPart = text.slice(0, yearMatch.index);
    const after = text.slice((yearMatch.index ?? 0) + yearMatch[0].length).replace(/^[.,]\s*/, "");
    const split = /^(.+?[^A-Z])\.\s+(.+)$/.exec(after);
    if (split) {
      title = split[1];
      venuePart = split[2];
    } else title = after;
  } else {
    // Authors. Title. Venue, Year.
    const pieces = text.split(/\.\s+(?=[A-Z"“一-鿿])/);
    if (pieces.length >= 3) {
      authorsPart = pieces[0];
      title = pieces[1];
      venuePart = pieces.slice(2).join(". ");
    } else if (pieces.length === 2) {
      title = pieces[0];
      venuePart = pieces[1];
    }
  }
  if (!title) return null;
  title = cleanTitle(title);
  if (title.length < 8) return null;

  const venue =
    collapse(
      venuePart
        .replace(/\bdoi:?\s*10\.\S+/gi, "")
        .replace(/https?:\/\/\S+/g, "")
        .replace(/\(?(19|20)\d{2}[a-z]?\)?/g, "")
        .replace(/\b(vol\.?|volume)\s*\d+.*$/i, "")
        .replace(/,?\s*\d+\s*\(\d+\).*$/, "")
        .replace(/,?\s*(pp\.?|pages?)\s*\d+.*$/i, "")
        .replace(/,\s*\d+\s*[,，].*$/, "")
        .replace(/^(in:?\s+)/i, ""),
    ).replace(/[.,;:\s]+$/, "") || null;

  const authors = authorsPart
    ? uniq(
        authorsPart
          .replace(/\bet al\.?/i, "")
          .replace(/\s*&\s*|\s+and\s+/g, ", ")
          .split(/,\s*(?=[A-Z][a-z]+,?\s*[A-Z]\.)|;\s*|,\s*(?=[A-Z]\.\s*[A-Z][a-z])|，|、/)
          .map((a) => a.replace(/[.,\s]+$/, "").trim())
          .filter((a) => a.length >= 2 && a.length <= 60 && !/^\d/.test(a)),
      ).slice(0, 30)
    : [];

  const status = /\b(under review|submitted|in review)\b|审稿中|在审/i.test(text)
    ? "under_review"
    : /\b(in preparation|in prep\.?|manuscript in preparation)\b|准备中/i.test(text)
      ? "in_preparation"
      : /\b(accepted|in press|forthcoming|to appear)\b|已录用|已接收/i.test(text)
        ? "accepted"
        : "published";
  return {
    title: clip(title, 300),
    authors,
    venue: venue ? clip(venue, 200) : null,
    year,
    doi,
    url,
    kind: guessKind(text, venue),
    status,
  };
}

export function parsePublications(sectionLines: string[]): Array<{ entry: PublicationEntry; quote: string }> {
  const out: Array<{ entry: PublicationEntry; quote: string }> = [];
  for (const raw of splitCitations(sectionLines)) {
    const entry = parseCitation(raw);
    if (entry) out.push({ entry, quote: clip(raw, 300) });
  }
  return uniq(out, (p) => p.entry.title.toLowerCase().replace(/[^a-z0-9一-鿿]/g, "")).slice(0, 300);
}

export interface GrantEntry {
  title: string;
  funder: string | null;
  year: number | null;
  amount: string | null;
}

export function parseGrants(sectionLines: string[]): Array<{ entry: GrantEntry; quote: string }> {
  const out: Array<{ entry: GrantEntry; quote: string }> = [];
  for (const raw of sectionLines) {
    const line = stripBullet(raw);
    if (line.length < 6) continue;
    const money = findMoney(line)[0] ?? null;
    const year = /\b((?:19|20)\d{2})\b/.exec(line);
    let rest = line;
    if (money) rest = rest.replace(money.text, " ");
    rest = rest.replace(/\(?\s*(19|20)\d{2}\s*(?:[-–—~至]\s*((19|20)\d{2}|present|至今))?\s*\)?/gi, " ").replace(/[(（]\s*[)）]/g, " ");
    const parts = collapse(rest)
      .split(/\s*[,，;；|]\s*|\s+[-–—]\s+/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (!parts.length) continue;
    out.push({
      entry: {
        title: clip(parts[0], 200),
        funder: parts.slice(1).find((p) => /foundation|council|institute|agency|nsf|nih|erc|ukri|dfg|nsfc|ministry|association|society|trust|university|基金|委员会|部|厅|学会/i.test(p)) ?? parts[1] ?? null,
        year: year ? Number(year[1]) : null,
        amount: money ? money.text : null,
      },
      quote: raw,
    });
  }
  return out.slice(0, 40);
}

export function findHIndex(text: string): number | null {
  const m = /\bh[- ]?index\s*[:=]?\s*(\d{1,3})\b/i.exec(text);
  return m ? Number(m[1]) : null;
}
