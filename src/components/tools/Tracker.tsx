"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { TrackerTool } from "@/content/tools/types";
import { dayToIso, formatDay, isoToDay, todayDays } from "./formulas";
import { useToolEvents } from "./shared";

/*
 * A job application tracker that lives in this browser only (localStorage, one key per tool).
 * Rows: company, role, date applied, status, next step, link, notes. Rows still on the first
 * status after `followUpDays` get a "follow up" flag. CSV export and import keep it portable.
 */

export interface TrackerRow {
  id: string;
  company: string;
  role: string;
  applied: number;
  status: string;
  next: string;
  link: string;
  notes: string;
}

const COLUMNS: (keyof TrackerRow)[] = ["company", "role", "applied", "status", "next", "link", "notes"];
const HEAD = ["Company", "Role", "Applied", "Status", "Next step", "Link", "Notes"];

const newId = () => Math.random().toString(36).slice(2, 10);

function csvCell(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function toCsv(rows: TrackerRow[]): string {
  const lines = [HEAD.join(",")];
  for (const r of rows) lines.push(COLUMNS.map((c) => csvCell(c === "applied" ? dayToIso(r.applied) : String(r[c] ?? ""))).join(","));
  return lines.join("\n");
}

/** The delimiter of the first line: comma, or semicolon / tab (Excel in decimal-comma locales, TSV files). */
function sniffDelimiter(text: string): string {
  const first = (text.split(/\r\n|\n|\r/).find((l) => l.trim()) ?? "").replace(/"[^"]*"/g, "");
  const n = (d: string) => first.split(d).length - 1;
  return [";", "\t"].reduce((best, d) => (n(d) > n(best) ? d : best), ",");
}

/** Minimal RFC 4180 reader: quoted cells, doubled quotes, delimiters and newlines inside quotes. */
export function parseCsv(text: string, delim = sniffDelimiter(text)): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      out.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    out.push(row);
  }
  return out.filter((r) => r.some((x) => x.trim()));
}

/** Bytes of an imported file → text: UTF-8 (BOM dropped), else Windows-1252, the "CSV" Excel saves by default. */
export function decodeCsv(bytes: ArrayBuffer | Uint8Array): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  // Excel's "Unicode Text" (.txt) is UTF-16 with a byte order mark.
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder("utf-16le").decode(b);
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder("utf-16be").decode(b);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

/** A posting link as typed or imported → absolute URL ("acme.com/jobs/1" would resolve against this page); not a web link → "". */
export function normalizeLink(v: string): string {
  const s = (v ?? "").trim();
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith("//")) return `https:${s}`;
  // mailto:, javascript:, data: and the like are not postings ("acme.com:8080" is a port, not a scheme).
  if (/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(s)) return "";
  // An email address is not a posting link ("hr@acme.com").
  return /^[^\s/?#:.@]+(\.[^\s/?#:.@]+)+(:\d+)?([/?#]\S*)?$/.test(s) ? `https://${s}` : "";
}

/** Statuses that are not a reply from the employer ("% heard back" leaves them out). */
export const NO_REPLY_STATUSES = ["No response"] as const;

/** Other trackers' words for a status → this tool's status (used only when the tool has that status). */
const STATUS_SYNONYMS: Record<string, string> = {
  submitted: "Applied",
  "phone screen": "Screen",
  screening: "Screen",
  "recruiter screen": "Screen",
  interviewing: "Interview",
  interviewed: "Interview",
  "final interview": "Final round",
  onsite: "Final round",
  "offer accepted": "Offer",
  "offer received": "Offer",
  offered: "Offer",
  "not selected": "Rejected",
  declined: "Rejected",
  rejection: "Rejected",
  ghosted: "No response",
  "no reply": "No response",
  "no answer": "No response",
  withdrew: "Withdrawn",
};

const DATE_LIKE = /^(\d{4}[-/.]\d{1,2}([-/.]\d{1,2})?|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})$/;
const YMD = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/;
const SLASH = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})$/;

/** A calendar date → days since 1970-01-01; NaN for a day that does not exist (Feb 30 is not rolled into March). */
function validDay(y: number, mo: number, d: number): number {
  const t = Date.UTC(y, mo - 1, d);
  const dt = new Date(t);
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? Math.floor(t / 86_400_000) : NaN;
}

/**
 * Day order of a column of Excel-style dates (10/15/2026 or 15/10/2026). Only when every filled cell is
 * one and some cell settles the order; a mixed or wholly ambiguous column → null (counted as unreadable).
 */
function slashOrder(cells: string[]): "mdy" | "dmy" | null {
  const filled = cells.map((c) => c.trim()).filter(Boolean);
  if (!filled.length || !filled.every((c) => SLASH.test(c))) return null;
  let dmy = false;
  let mdy = false;
  for (const c of filled) {
    const m = SLASH.exec(c)!;
    if (+m[1] > 12) dmy = true;
    if (+m[2] > 12) mdy = true;
  }
  return dmy === mdy ? null : dmy ? "dmy" : "mdy";
}

function parseDateCell(s: string, order: "mdy" | "dmy" | null): number {
  const v = s.trim();
  const ymd = YMD.exec(v);
  if (ymd) return validDay(+ymd[1], +ymd[2], +ymd[3]);
  const m = SLASH.exec(v);
  if (!m || !order) return NaN;
  const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
  return order === "mdy" ? validDay(y, +m[1], +m[2]) : validDay(y, +m[2], +m[1]);
}

const statusKey = (s: string) => s.trim().toLowerCase().replace(/[\s_-]+/g, " ");

export interface CsvImport {
  rows: TrackerRow[];
  unreadableDates: number;
  /** Statuses this tool does not know: set to the first status, the original kept in notes. */
  unknownStatuses: number;
  /** Set when nothing was imported, as a sentence for the visitor. */
  error?: string;
}

/**
 * CSV rows → tracker rows. Columns are found by their header (Company name, Job title, Date applied…);
 * a file without a header row is read as company, role. Dates are YYYY-MM-DD, or an Excel column of
 * 10/15/2026 or 15/10/2026 whose order the column settles; a date that cannot be read becomes today
 * and is counted in `unreadableDates`, so the import can say so instead of hiding it.
 */
export function rowsFromCsv(text: string, statuses: readonly string[]): CsvImport {
  const table = parseCsv(text);
  if (!table.length) return { rows: [], unreadableDates: 0, unknownStatuses: 0 };
  const head = table[0].map((h) => h.trim().toLowerCase().replace(/[^a-z]+/g, " ").trim());
  // Most specific name first, so "Date applied" wins over a yes/no "Applied?" column and "Job title" over "Job #".
  const idx = (names: string[]) => names.reduce((found, n) => (found >= 0 ? found : head.indexOf(n)), -1);
  const at = {
    company: idx(["company", "company name", "organization", "organisation", "employer", "employer name"]),
    role: idx(["job title", "job position", "position title", "role title", "position", "role", "title", "job"]),
    applied: idx(["date applied", "applied date", "applied on", "application date", "applied", "date"]),
    status: idx(["status", "stage", "application status"]),
    next: idx(["next step", "next", "next steps", "follow up"]),
    link: idx(["link", "url", "posting", "job link", "posting link"]),
    notes: idx(["notes", "note", "comments"]),
  };
  const isStatus = (c: string) => statuses.some((s) => statusKey(s) === statusKey(c));
  // A header names a column ("Applied" alone may be a status in a headerless file) and holds no date.
  const named = table[0].filter((c, i) => Object.values(at).includes(i) && !isStatus(c)).length >= 2;
  const hasHeader = at.company >= 0 || (named && !table[0].some((c) => DATE_LIKE.test(c.trim())));
  if (hasHeader && at.company < 0) {
    return { rows: [], unreadableDates: 0, unknownStatuses: 0, error: 'The first row names columns but none is "Company" (or Employer, Organization), so nothing was imported.' };
  }
  const body = hasHeader ? table.slice(1) : table;
  const cell = (r: string[], k: keyof typeof at) => (hasHeader && at[k] >= 0 ? (r[at[k]] ?? "").trim() : "");
  const order = slashOrder(body.map((r) => cell(r, "applied")));
  let unreadableDates = 0;
  let unknownStatuses = 0;
  const rows = body.map((r) => {
    const get = (k: keyof typeof at) => cell(r, k);
    const day = parseDateCell(get("applied"), order);
    if (!Number.isFinite(day)) unreadableDates++;
    const raw = get("status");
    const key = statusKey(raw);
    const status = statuses.find((s) => statusKey(s) === key) ?? statuses.find((s) => s === STATUS_SYNONYMS[key]);
    if (raw && !status) unknownStatuses++;
    const notes = [raw && !status ? `Status in file: ${raw}` : "", get("notes")].filter(Boolean).join(" · ");
    return {
      id: newId(),
      company: hasHeader ? get("company") : (r[0] ?? "").trim(),
      role: hasHeader ? get("role") : (r[1] ?? "").trim(),
      applied: Number.isFinite(day) ? day : todayDays(),
      status: status ?? statuses[0],
      next: get("next"),
      link: normalizeLink(get("link")),
      notes,
    };
  });
  return { rows, unreadableDates, unknownStatuses };
}

/** Saved JSON → rows. Drops malformed entries; a lost date (NaN is saved as null) becomes today. */
export function rowsFromStorage(raw: string | null): TrackerRow[] | null {
  const parsed: unknown = raw ? JSON.parse(raw) : null;
  if (!Array.isArray(parsed)) return null;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  return parsed
    .filter((r) => r && typeof r.company === "string" && typeof r.status === "string")
    .map((r) => ({ id: str(r.id) || newId(), company: r.company, role: str(r.role), applied: Number.isFinite(r.applied) ? r.applied : todayDays(), status: r.status, next: str(r.next), link: str(r.link), notes: str(r.notes) }));
}

/** A `storage` event from another tab → the rows it saved for `key` (null when cleared); undefined = ignore it. */
export function rowsFromStorageEvent(e: Pick<StorageEvent, "key" | "newValue">, key: string): TrackerRow[] | null | undefined {
  if (e.key !== key && e.key !== null) return undefined;
  try {
    return rowsFromStorage(e.newValue);
  } catch {
    // The other tab left a value this tab cannot read: keep the list on screen.
    return undefined;
  }
}

function download(name: string, text: string) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function TrackerView({ tool }: { tool: TrackerTool }) {
  const key = `os-tool:${tool.id}`;
  const events = useToolEvents(tool);
  const today = todayDays();
  const examples = useMemo<TrackerRow[]>(
    () => (tool.examples ?? []).map((e, i) => ({ id: `ex${i}`, company: e.company, role: e.role, applied: today - e.daysAgo, status: e.status, next: e.next ?? "", link: "", notes: "" })),
    [tool.examples, today],
  );
  // The runner renders tools only after hydration, so reading localStorage here never mismatches the server HTML.
  const [rows, setRows] = useState<TrackerRow[] | null>(() => {
    try {
      return rowsFromStorage(window.localStorage.getItem(key));
    } catch {
      return null;
    }
  });
  const [draft, setDraft] = useState({ company: "", role: "", link: "" });
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const ids = { company: useId(), role: useId(), link: useId() };

  const save = (next: TrackerRow[]) => {
    setRows(next);
    try {
      window.localStorage.setItem(key, JSON.stringify(next));
    } catch {
      setMsg("This browser blocks saving; export a CSV before you leave the page.");
    }
  };

  // Another tab saved this list: take its rows, so an edit here never overwrites what it added.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      const next = rowsFromStorageEvent(e, key);
      if (next !== undefined) setRows(next);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [key]);

  const showing = rows ?? examples;
  const isExample = rows === null;
  const first = tool.statuses[0];
  const flagged = (r: TrackerRow) => r.status === first && today - r.applied >= tool.followUpDays;
  const counts = tool.statuses.map((s) => ({ s, n: showing.filter((r) => r.status === s).length }));
  // Withdrawn rows are left out of the rate; "No response" rows count as applications that never heard back.
  const counted = showing.filter((r) => r.status !== "Withdrawn");
  const responded = counted.filter((r) => r.status !== first && !(NO_REPLY_STATUSES as readonly string[]).includes(r.status)).length;

  const add = () => {
    if (!draft.company.trim() || !draft.role.trim()) {
      setMsg("Add a company and a role.");
      return;
    }
    if (draft.link.trim() && !normalizeLink(draft.link)) {
      setMsg("The posting link should be a web address, like acme.com/jobs/123.");
      return;
    }
    setMsg(null);
    events.result({ rows: (rows?.length ?? 0) + 1 });
    save([{ id: newId(), company: draft.company.trim(), role: draft.role.trim(), applied: today, status: first, next: "", link: normalizeLink(draft.link), notes: "" }, ...(rows ?? [])]);
    setDraft({ company: "", role: "", link: "" });
  };

  const update = (id: string, patch: Partial<TrackerRow>) => {
    events.used();
    const base = rows ?? [];
    save(base.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
        <div className="min-w-0">
          <label htmlFor={ids.company} className="field-label">
            Company
          </label>
          <input id={ids.company} className="input" value={draft.company} placeholder="Acme Health" onChange={(e) => setDraft({ ...draft, company: e.target.value })} onKeyDown={(e) => e.key === "Enter" && add()} />
        </div>
        <div className="min-w-0">
          <label htmlFor={ids.role} className="field-label">
            Role
          </label>
          <input id={ids.role} className="input" value={draft.role} placeholder="Data analyst" onChange={(e) => setDraft({ ...draft, role: e.target.value })} onKeyDown={(e) => e.key === "Enter" && add()} />
        </div>
        <div className="min-w-0">
          <label htmlFor={ids.link} className="field-label">
            Posting link <span className="font-normal text-ink-4">(optional)</span>
          </label>
          <input id={ids.link} className="input" value={draft.link} placeholder="https://…" onChange={(e) => setDraft({ ...draft, link: e.target.value })} onKeyDown={(e) => e.key === "Enter" && add()} />
        </div>
        <button type="button" className="btn btn-primary" onClick={add}>
          Add application
        </button>
      </div>
      {msg ? (
        <p className="mt-2 text-[0.9rem] text-bad" role="status">
          {msg}
        </p>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-2 text-[0.86rem]" aria-live="polite">
        {isExample ? <span className="tag tag-accent">Example rows: add your first application to start</span> : null}
        <span className="tag">
          {showing.length} {showing.length === 1 ? "application" : "applications"}
        </span>
        <span className="tag tag-pine">
          {counted.length ? Math.round((responded / counted.length) * 100) : 0}% heard back
        </span>
        {counts
          .filter((c) => c.n)
          .map((c) => (
            <span key={c.s} className="tag">
              {c.s}: {c.n}
            </span>
          ))}
      </div>

      <ul className="mt-3 grid gap-2">
        {showing.map((r) => {
          const age = today - r.applied;
          const href = normalizeLink(r.link);
          return (
            <li key={r.id} className="pane-inset min-w-0 px-4 py-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <p className="min-w-0 flex-1 text-[1rem] leading-snug text-ink">
                  <span className="font-semibold">{r.company}</span> · {r.role}
                  {href ? (
                    <a href={href} target="_blank" rel="noopener noreferrer" className="ml-2 text-[0.84rem] text-accent-text underline">
                      posting
                    </a>
                  ) : null}
                </p>
                {flagged(r) ? <span className="tag tag-bad">Follow up · {age} days</span> : <span className="text-[0.82rem] tabular-nums text-ink-4">{age === 0 ? "today" : `${age} days ago`}</span>}
                <select aria-label={`Status for ${r.company}`} className="select !w-auto !py-1.5 text-[0.9rem]" value={r.status} disabled={isExample} onChange={(e) => update(r.id, { status: e.target.value })}>
                  {tool.statuses.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                {!isExample ? (
                  <button type="button" className="btn btn-quiet btn-sm" aria-label={`Remove ${r.company}`} onClick={() => save((rows ?? []).filter((x) => x.id !== r.id))}>
                    Remove
                  </button>
                ) : null}
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-[160px_1fr]">
                <input
                  aria-label="Date applied"
                  type="date"
                  max="9999-12-31"
                  className="input !py-1.5 text-[0.9rem]"
                  value={dayToIso(r.applied)}
                  disabled={isExample}
                  onChange={(e) => {
                    // A half-typed or five-digit year reads as NaN: keep the saved date.
                    const d = isoToDay(e.target.value);
                    if (Number.isFinite(d)) update(r.id, { applied: d });
                  }}
                />
                <input aria-label="Next step" className="input !py-1.5 text-[0.9rem]" placeholder="Next step, e.g. follow up with the recruiter" value={r.next} disabled={isExample} onChange={(e) => update(r.id, { next: e.target.value })} />
              </div>
              <p className="sr-only">Applied {formatDay(r.applied)}</p>
            </li>
          );
        })}
      </ul>

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className="btn btn-ghost btn-sm" disabled={isExample} onClick={() => download("job-applications.csv", "\uFEFF" + toCsv(rows ?? []))}>
          Export CSV
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()}>
          Import CSV
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values"
          className="sr-only"
          aria-label="Import a CSV file"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            const res = rowsFromCsv(decodeCsv(await f.arrayBuffer()), tool.statuses);
            e.target.value = "";
            if (res.error) {
              setMsg(res.error);
              return;
            }
            const { rows: imported, unreadableDates, unknownStatuses } = res;
            save([...imported, ...(rows ?? [])]);
            const n = imported.length;
            setMsg(
              [
                `Imported ${n} ${n === 1 ? "row" : "rows"}${unreadableDates ? `; ${unreadableDates} ${unreadableDates === 1 ? "date" : "dates"} could not be read (use YYYY-MM-DD) and ${unreadableDates === 1 ? "was" : "were"} set to today` : ""}.`,
                unknownStatuses ? `${unknownStatuses} ${unknownStatuses === 1 ? "status was" : "statuses were"} not recognised and set to "${tool.statuses[0]}" (the original is kept in notes).` : "",
              ]
                .filter(Boolean)
                .join(" "),
            );
          }}
        />
      </div>
      {tool.note ? <p className="mt-3 text-[0.84rem] leading-relaxed text-ink-4">{tool.note}</p> : null}
    </div>
  );
}
