"use client";

import { useId, useMemo, useRef, useState } from "react";
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
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function toCsv(rows: TrackerRow[]): string {
  const lines = [HEAD.join(",")];
  for (const r of rows) lines.push(COLUMNS.map((c) => csvCell(c === "applied" ? dayToIso(r.applied) : String(r[c] ?? ""))).join(","));
  return lines.join("\n");
}

/** Minimal RFC 4180 reader: quoted cells, doubled quotes, commas and newlines inside quotes. */
export function parseCsv(text: string): string[][] {
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
    else if (c === ",") {
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

export function rowsFromCsv(text: string, statuses: readonly string[]): TrackerRow[] {
  const table = parseCsv(text);
  if (!table.length) return [];
  const head = table[0].map((h) => h.trim().toLowerCase());
  const idx = (names: string[]) => head.findIndex((h) => names.includes(h));
  const at = {
    company: idx(["company", "organization", "employer"]),
    role: idx(["role", "position", "title", "job"]),
    applied: idx(["applied", "date", "date applied"]),
    status: idx(["status", "stage"]),
    next: idx(["next step", "next", "follow up"]),
    link: idx(["link", "url", "posting"]),
    notes: idx(["notes", "note"]),
  };
  const body = at.company >= 0 ? table.slice(1) : table;
  return body.map((r) => {
    const get = (k: keyof typeof at) => (at[k] >= 0 ? (r[at[k]] ?? "").trim() : "");
    const day = isoToDay(get("applied"));
    const status = statuses.find((s) => s.toLowerCase() === get("status").toLowerCase()) ?? statuses[0];
    return { id: newId(), company: get("company") || (r[0] ?? ""), role: get("role") || (r[1] ?? ""), applied: Number.isFinite(day) ? day : todayDays(), status, next: get("next"), link: get("link"), notes: get("notes") };
  });
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
      const raw = window.localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as TrackerRow[]) : null;
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

  const showing = rows ?? examples;
  const isExample = rows === null;
  const first = tool.statuses[0];
  const flagged = (r: TrackerRow) => r.status === first && today - r.applied >= tool.followUpDays;
  const counts = tool.statuses.map((s) => ({ s, n: showing.filter((r) => r.status === s).length }));
  const responded = showing.filter((r) => r.status !== first).length;

  const add = () => {
    if (!draft.company.trim() || !draft.role.trim()) {
      setMsg("Add a company and a role.");
      return;
    }
    setMsg(null);
    events.result({ rows: (rows?.length ?? 0) + 1 });
    save([{ id: newId(), company: draft.company.trim(), role: draft.role.trim(), applied: today, status: first, next: "", link: draft.link.trim(), notes: "" }, ...(rows ?? [])]);
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
          {showing.length ? Math.round((responded / showing.length) * 100) : 0}% heard back
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
          return (
            <li key={r.id} className="pane-inset min-w-0 px-4 py-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <p className="min-w-0 flex-1 text-[1rem] leading-snug text-ink">
                  <span className="font-semibold">{r.company}</span> · {r.role}
                  {r.link ? (
                    <a href={r.link} target="_blank" rel="noopener noreferrer" className="ml-2 text-[0.84rem] text-accent-text underline">
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
                <input aria-label="Date applied" type="date" className="input !py-1.5 text-[0.9rem]" value={dayToIso(r.applied)} disabled={isExample} onChange={(e) => e.target.value && update(r.id, { applied: isoToDay(e.target.value) })} />
                <input aria-label="Next step" className="input !py-1.5 text-[0.9rem]" placeholder="Next step, e.g. follow up with the recruiter" value={r.next} disabled={isExample} onChange={(e) => update(r.id, { next: e.target.value })} />
              </div>
              <p className="sr-only">Applied {formatDay(r.applied)}</p>
            </li>
          );
        })}
      </ul>

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className="btn btn-ghost btn-sm" disabled={isExample} onClick={() => download("job-applications.csv", toCsv(rows ?? []))}>
          Export CSV
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()}>
          Import CSV
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          aria-label="Import a CSV file"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            const imported = rowsFromCsv(await f.text(), tool.statuses);
            save([...imported, ...(rows ?? [])]);
            setMsg(`Imported ${imported.length} rows.`);
            e.target.value = "";
          }}
        />
      </div>
      {tool.note ? <p className="mt-3 text-[0.84rem] leading-relaxed text-ink-4">{tool.note}</p> : null}
    </div>
  );
}
