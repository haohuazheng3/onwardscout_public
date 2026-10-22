"use client";

import { useId, useMemo, useState } from "react";
import type { KeywordsTool } from "@/content/tools/types";
import { CopyButton, useToolEvents } from "./shared";

/*
 * Job description → the phrases it leans on → which of them a résumé already uses.
 * Purely lexical and fully in the browser: unigrams, bigrams and trigrams without stop words,
 * scored by frequency, by appearing on a requirement line ("required", "must", "experience
 * with"…) and by being written as a proper name or acronym in the posting ("Salesforce",
 * "SQL"). A phrase counts as present when the résumé contains it, ignoring case, plurals, accents and
 * hyphens ("cross-functional" = "cross functional", "e-commerce" = "ecommerce").
 */

const STOP = new Set(
  (
    "a about above across after again against all also am an and any are as at be because been before being below between both but by can could did do does doing down during each either else ever every few for from further get gets got had has have having he her here hers herself him himself his how i if in into is it its itself just least less like may me might more most much must my myself no nor not now of off on once one only or other our ours ourselves out over own per please same shall she should so some such than that the their theirs them themselves then there these they this those through to too under until up upon us use used using very via was we were what when where whether which while who whom whose why will with within without would yet you your yours yourself yourselves " +
    "ability able across additional apply applicants applicant benefits best candidate candidates company culture day days demonstrated desired duties environment equal employer etc excellent experience experienced familiarity first full great help ideal including job join key level looking make new opportunity opportunities part plus position preferred proven qualifications qualified related required requirement requirements responsibilities responsible role skills strong successful support team teams time type well work working world year years " +
    "build building create creating develop developing drive driving ensure find findings have help helping lead leading manage managing nice own owning partner partnering present presenting provide providing use using write writing collaborate collaborating join joining will want wanted seeking seek like love " +
    "youll youre youve youd weve theyll theyre theyve dont doesnt isnt arent cant wont ive lets proficiency proficient familiar hands-on bonus provides ensures manages develops creates helps works writes uses owns seeks wants loves includes requires maintains oversees assists performs participates collaborates contributes utilizes"
  ).split(/\s+/),
);

const CUE = /\b(required|requirements?|must|qualifications?|experience (?:with|in)|proficien\w*|knowledge of|familiar\w*|expertise|skilled in|hands-on|nice to have|preferred|bonus|plus)\b/i;

/** "&" stays inside a name ("M&A", "FP&A"), and the dot of ".NET" stays so it never reads as "net". */
function norm(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9+#&./\s-]/g, " ")
    .replace(/(?<![a-z0-9])(?!\.net\b)[&./-]|[&./-](?![a-z0-9])/g, " ");
}

/** "Montréal", "Naïve", "résumé" → plain letters, so they neither split into fragments nor miss the unaccented spelling. */
const fold = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/** "Python/SQL", "AWS/GCP", "C/C++" are lists; "CI/CD", "A/B", "UI/UX", "PL/SQL" are single terms. */
const unslash = (t: string) =>
  t.replace(/(?<![A-Za-z0-9+#.])\.?[A-Za-z0-9+#]+(?:\.[A-Za-z0-9+#]+)*(?:\/\.?[A-Za-z0-9+#]+(?:\.[A-Za-z0-9+#]+)*)+/g, (m) => {
    const ps = m.split("/");
    return ps.every((p) => p.length >= 3) || ps.some((p) => /[+#]/.test(p)) ? ps.join(", ") : m;
  });

/** "Salesforce.com" is "Salesforce". */
function tokens(text: string): string[] {
  return norm(text).replace(/(?<=[a-z0-9])\.com(?![a-z0-9])/g, "").split(/\s+/).filter(Boolean);
}

/** Plural → singular for matching ("dashboards" → "dashboard"), leaving words like "analysis", "class", "status" alone. */
const stem = (w: string) => {
  if (w.length < 4 || !w.endsWith("s") || w === "news") return w;
  if (/(?:ys|thes|gnos)es$/.test(w)) return `${w.slice(0, -2)}is`; // analyses, diagnoses, hypotheses
  if (w.length > 4 && w.endsWith("ies")) return `${w.slice(0, -3)}y`; // technologies, queries
  if (/(?:ss|ch|sh|x|zz)es$/.test(w)) return w.slice(0, -2); // processes, launches, taxes
  if (/(?:ss|us)$/.test(w) || (w.length > 4 && w.endsWith("is")) || (w.length > 7 && w.endsWith("ics"))) return w; // class, status, analysis, analytics
  return w.slice(0, -1); // apis, surveys, journeys, metrics
};
const singular = (w: string) => stem(w).replace(/che$/, "ch"); // cache/caches, niche/niches
/** All-caps acronym plurals (APIs, KPIs, RNs) before lower-casing loses the case. */
const deplural = (t: string) => t.replace(/\b([A-Z]{2,})s\b/g, "$1");
/** "AIDS", "CMMS", "ACLS" are names, not plurals of "aid", "cmm", "acl". */
const singularIn = (t: string) => {
  const caps = new Set((t.match(/\b[A-Z]{3}S\b/g) ?? []).map((w) => w.toLowerCase()));
  return (w: string) => (caps.has(w) ? w : singular(w));
};

export interface KeywordHit {
  phrase: string;
  count: number;
  score: number;
  present: boolean;
}

/**
 * Keywords of a job description. Matching uses a singular key ("dashboards" and "dashboard" are one
 * keyword); `phrase` is the posting's own wording as first written, lower-cased ("sales", "kubernetes"),
 * so what the person copies matches the employer's words exactly.
 */
export function extractKeywords(jd: string, max: number, extraStop: readonly string[] = []): { phrase: string; key: string; count: number; score: number }[] {
  jd = unslash(fold(jd));
  const sing = singularIn(jd);
  const stop = new Set([...STOP, ...extraStop.map((s) => s.toLowerCase())]);
  // The languages R and C, written alone in capitals ("Python or R"), are the only one-letter keywords.
  const singles = new Set([...jd.matchAll(/(?<![\w&.+#-])([RC])(?![\w&+#-])/g)].map((m) => m[1].toLowerCase()));
  const proper = new Set<string>();
  for (const m of jd.matchAll(/\b([A-Z][a-zA-Z0-9+#.]*[A-Z0-9+#][a-zA-Z0-9+#.]*|[A-Z][a-z]+[A-Z][A-Za-z]*|[A-Z]{2,})\b/g)) proper.add(m[1].toLowerCase());
  // Names as written mid-line (SQL, Python, Salesforce), not a bullet's or a sentence's first word.
  const names = new Set(proper);
  for (const m of jd.matchAll(/(?<!^[ \t]*(?:[-*•·▪◦‣–]|\d+[.)])?[ \t]*|[.!?]\s)\b([A-Z][a-z]{2,})\b/gm)) names.add(m[1].toLowerCase());
  for (const m of jd.matchAll(/(?<!^|[.!?]\s)\b([A-Z][a-z]{2,})\b/gm)) proper.add(m[1].toLowerCase());
  const stats = new Map<string, { count: number; cue: number; form: string }>();
  // A requirement cue ("Requirements:", "experience with", "nice to have") applies to its whole line;
  // phrases never cross punctuation ("Data Analyst, Customer Insights" is two phrases, not one).
  const segments = jd.split(/\n|(?<=[.!?])\s/).flatMap((line) => line.split(/[,;:()]/).map((seg) => ({ seg, cue: CUE.test(line) ? 1 : 0 })));
  for (const { seg, cue } of segments) {
    const toks = tokens(seg);
    const keys = tokens(deplural(seg)).map(sing);
    for (let n = 1; n <= 3; n++) {
      for (let i = 0; i + n <= toks.length; i++) {
        const gram = toks.slice(i, i + n);
        if (gram.some((t) => stop.has(t) || !/[a-z]/.test(t) || (t.length < 2 && !singles.has(t)))) continue;
        const key = keys.slice(i, i + n).join(" ");
        const s = stats.get(key) ?? { count: 0, cue: 0, form: gram.join(" ") };
        s.count++;
        s.cue += cue;
        stats.set(key, s);
      }
    }
  }
  const scored = [...stats.entries()]
    .map(([phrase, s]) => {
      const words = phrase.split(" ");
      const isProper = words.some((w) => proper.has(w.replace(/^\./, "")) || proper.has(`${w}s`));
      const score = s.count * (1 + 0.9 * (words.length - 1)) + s.cue * 0.9 + (isProper ? 1.2 : 0);
      return { phrase, form: s.form, count: s.count, score, words: words.length, name: words.some((w) => names.has(w) || names.has(`${w}s`)) };
    })
    .filter((x) => (x.words > 1 ? x.count >= 2 || x.score >= 2.7 : x.count >= 2 || x.score >= 1.85))
    .sort((a, b) => b.score - a.score || a.phrase.localeCompare(b.phrase));
  const kept: { phrase: string; form: string; count: number; score: number; name: boolean }[] = [];
  const contains = (long: string, short: string) => long !== short && ` ${long} `.includes(` ${short} `);
  for (const x of scored) {
    if (kept.length >= max * 2) break;
    if (kept.some((o) => contains(o.phrase, x.phrase) && o.count >= x.count)) continue;
    for (let i = kept.length - 1; i >= 0; i--) if (contains(x.phrase, kept[i].phrase) && x.count >= kept[i].count) kept.splice(i, 1);
    kept.push({ phrase: x.phrase, form: x.form, count: x.count, score: Math.round(x.score * 10) / 10, name: x.name });
  }
  // Drop a phrase only when every one of its occurrences sits inside an occurrence of a longer kept
  // phrase ("customer" inside "customer insights" and "customer segmentation"). Checked occurrence by
  // occurrence: "SQL" inside "complex SQL queries" and alone in "experience with SQL" stays.
  const segToks = segments.map(({ seg }) => tokens(deplural(seg)).map(sing));
  const spans = (phrase: string) => {
    const words = phrase.split(" ");
    const out: [number, number, number][] = [];
    segToks.forEach((toks, s) => {
      for (let i = 0; i + words.length <= toks.length; i++) if (words.every((w, k) => toks[i + k] === w)) out.push([s, i, i + words.length]);
    });
    return out;
  };
  // A repeated name ("SQL" ×3) is never hidden behind one-off phrases around it ("tune SQL queries").
  const longer = (p: { phrase: string; count: number; name: boolean }) =>
    kept
      .filter((q) => contains(q.phrase, p.phrase) && (q.count >= 2 || p.count < 2 || !p.name))
      .map((q) => spans(q.phrase))
      .flat();
  const out = kept
    .filter((p) => {
      const covers = longer(p);
      return spans(p.phrase).some(([s, a, b]) => !covers.some(([t, c, d]) => t === s && c <= a && b <= d));
    })
    .slice(0, max);
  const shown = new Set<string>();
  return out.filter((p) => !shown.has(p.form) && !!shown.add(p.form)).map((p) => ({ phrase: p.form, key: p.phrase, count: p.count, score: p.score }));
}

export function matchKeywords(jd: string, resume: string, max: number, extraStop: readonly string[] = []): KeywordHit[] {
  const text = unslash(fold(resume));
  const cv = tokens(deplural(text)).map(singularIn(text)).join(" ");
  // Hyphen, space and joined spellings are one term ("cross-functional", "e-commerce" / "ecommerce").
  const haves = [cv, cv.replace(/-/g, " "), cv.replace(/-/g, "")].map((h) => ` ${h} `);
  const has = (key: string) => [key, key.replace(/-/g, " "), key.replace(/-/g, "")].some((k) => (k.includes(" ") ? haves : [haves[0], haves[2]]).some((h) => h.includes(` ${k} `)));
  // R or C counts only as a capital standing alone, not a middle initial ("Jane C. Doe").
  const singles = new Set([...text.matchAll(/(?<![\w&.+#-])(?<![A-Z][a-z]+\s(?=[RC]\.?\s+[A-Z][a-z]))([RC])(?![\w&+#-])/g)].map((m) => m[1].toLowerCase()));
  return extractKeywords(jd, max, extraStop).map(({ key, ...k }) => ({ ...k, present: key.length === 1 ? singles.has(key) : has(key) }));
}

export function KeywordsView({ tool }: { tool: KeywordsTool }) {
  const [jd, setJd] = useState("");
  const [cv, setCv] = useState("");
  const a = useId();
  const b = useId();
  const events = useToolEvents(tool);
  const max = tool.maxKeywords ?? 30;
  const hits = useMemo(() => (jd.trim().split(/\s+/).length >= 25 ? matchKeywords(jd, cv, max, tool.extraStopwords) : []), [jd, cv, max, tool.extraStopwords]);
  const missing = hits.filter((h) => !h.present);
  const present = hits.filter((h) => h.present);
  const pct = hits.length ? Math.round((present.length / hits.length) * 100) : 0;
  const hasCv = cv.trim().length > 0;

  return (
    <div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="min-w-0">
          <label htmlFor={a} className="field-label">
            {tool.source.label}
          </label>
          <textarea
            id={a}
            className="input !min-h-0"
            rows={tool.source.rows ?? 9}
            placeholder={tool.source.placeholder}
            value={jd}
            onChange={(e) => {
              setJd(e.target.value);
              events.used();
            }}
          />
        </div>
        <div className="min-w-0">
          <label htmlFor={b} className="field-label">
            {tool.target.label}
          </label>
          <textarea
            id={b}
            className="input !min-h-0"
            rows={tool.target.rows ?? 9}
            placeholder={tool.target.placeholder}
            value={cv}
            onChange={(e) => {
              setCv(e.target.value);
              if (jd.trim()) events.result({ keywords: hits.length });
            }}
          />
        </div>
      </div>

      <div className="mt-5" aria-live="polite">
        {!hits.length ? (
          <p className="text-[0.9rem] text-ink-4">Paste a job description of at least a short paragraph; the keywords appear as you type.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              {hasCv ? (
                <p className="text-[1.02rem] text-ink">
                  <span className="font-semibold tabular-nums">
                    {present.length} of {hits.length}
                  </span>{" "}
                  keywords already in your résumé <span className="tag tag-pine ml-1 tabular-nums">{pct}%</span>
                </p>
              ) : (
                <p className="text-[1.02rem] text-ink">
                  <span className="font-semibold tabular-nums">{hits.length}</span> keywords this posting leans on. Paste your résumé to see which are missing.
                </p>
              )}
              <CopyButton text={(hasCv ? missing : hits).map((h) => h.phrase).join(", ")} label={hasCv ? "Copy missing" : "Copy keywords"} className="btn btn-ghost btn-sm" />
            </div>
            {hasCv && missing.length ? (
              <section className="mt-4" aria-label="Missing keywords">
                <p className="eyebrow text-bad">Missing · {missing.length}</p>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {missing.map((h) => (
                    <li key={h.phrase} className="tag tag-bad">
                      {h.phrase}
                      <span className="ml-1 opacity-70">×{h.count}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            <section className="mt-4" aria-label={hasCv ? "Keywords you already use" : "Keywords"}>
              <p className={`eyebrow ${hasCv ? "text-ok" : ""}`}>{hasCv ? `Already there · ${present.length}` : "Keywords by weight"}</p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {(hasCv ? present : hits).map((h) => (
                  <li key={h.phrase} className={`tag ${hasCv ? "tag-ok" : ""}`}>
                    {h.phrase}
                    <span className="ml-1 opacity-70">×{h.count}</span>
                  </li>
                ))}
              </ul>
            </section>
            {tool.note ? <p className="mt-4 text-[0.84rem] leading-relaxed text-ink-4">{tool.note}</p> : null}
          </>
        )}
      </div>
    </div>
  );
}
