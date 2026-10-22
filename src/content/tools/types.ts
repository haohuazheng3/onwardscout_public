/**
 * Interactive tools for tool-first guides: one JSON file per tool at content/tools/<id>.json
 * (the file name must equal the tool's `id`). The blog page that embeds a tool names it in
 * its frontmatter (`tool: <id>`); the server validates every file with the zod schema at
 * build time and hands exactly one tool to the client renderer as plain data.
 *
 * This file is the whole contract. The TypeScript interfaces document every field; the zod
 * schema below enforces them (unknown keys are rejected, so a typo fails the build instead
 * of silently doing nothing) and adds the cross-field rules listed under each kind.
 *
 * ── Fields shared by every tool ─────────────────────────────────────────────────────────
 *   id          lower-case letters, digits and hyphens; equals the file name
 *   kind        generator | calculator | checker | quiz | decision | checklist | brief |
 *               teleprompter | keywords | tracker | finder
 *   title       H2 at the top of the tool pane (the article title stays the page's H1)
 *   lede        one sentence under the title: what the tool does and for whom
 *   ctaLabel?   button text of the call to action under the tool, default "Let Onward Scout prepare the next one"
 *   ctaHref?    default "/app/start" (or /for/<audience>, /opportunities/<type>, /pricing)
 *   ctaNote?    one line under the call to action
 *   schemaName? WebApplication name in the page's JSON-LD, default `title`
 *
 * ── Inputs (generator, brief, and the numeric subset for calculator) ──────────
 *   id must be a formula/template identifier: a letter, then letters, digits or underscores.
 *   text        single line            textarea  several lines (list filters read the lines)
 *   select      one option             multiselect  several options
 *   number      numeric with unit      toggle    yes / no
 *   date        a calendar day (defaults to today + defaultOffsetDays)
 *   In templates a select prints its option *label*; in formulas it is Number(option value);
 *   a toggle prints "yes"/"no" in templates and is 1/0 in formulas; a date prints "Tue 28 Oct
 *   2026" in templates and is the number of days since 1970-01-01 in formulas.
 *
 * ── Conditions (`when`) on generator variant groups and brief sections ─────────────────
 *   { input: "<id>", is: "value" | ["v1","v2"] }   the group/section is used only when the
 *   { input: "<id>", not: "value" | [...] }        input's value matches (a toggle's value is
 *                                                  "true"/"false"; a multiselect matches when
 *                                                  it includes the value).
 */

import { z } from "zod";
import { compileFormula, FormulaError, type OutputFormat } from "@/components/tools/formulas";
import { invalidRanges, placeholderIds, unknownFilters } from "@/components/tools/templating";

export const TOOL_KINDS = ["generator", "calculator", "checker", "quiz", "decision", "checklist", "brief", "teleprompter", "keywords", "tracker", "finder"] as const;
export type ToolKind = (typeof TOOL_KINDS)[number];

export const DEFAULT_CTA_HREF = "/app/start";
export const DEFAULT_CTA_LABEL = "Let Onward Scout prepare the next one";
export const DEFAULT_VARIANT_COUNT = 5;
export const DEFAULT_WORDS_PER_SECOND = 2.5;

/* ─────────────────────────── shared pieces ─────────────────────────── */

export interface Cta {
  label: string;
  /** Site path ("/pricing") or https URL. */
  href: string;
}

export interface SelectOption {
  /** Stable key; what `when` conditions compare against and what formulas read as a number. */
  value: string;
  /** What the seller sees, and what templates print. */
  label: string;
}

interface InputBase {
  id: string;
  label: string;
  /** One line under the label. */
  help?: string;
  /** Show the field only while this holds (a closing date only once "it closes on a set day" is picked). */
  when?: When | When[];
}

export interface TextInput extends InputBase {
  type: "text";
  placeholder?: string;
  default?: string;
  maxLength?: number;
  /** Generator/brief: output waits until this input has a value. */
  required?: boolean;
}

export interface TextareaInput extends InputBase {
  type: "textarea";
  placeholder?: string;
  default?: string;
  maxLength?: number;
  /** Visible rows, default 4. */
  rows?: number;
  required?: boolean;
}

export interface SelectInput extends InputBase {
  type: "select";
  options: SelectOption[];
  /** Option value; default = the first option. */
  default?: string;
  /** Render as chips (default when ≤ 5 options) or a dropdown. */
  display?: "chips" | "dropdown";
}

export interface MultiselectInput extends InputBase {
  type: "multiselect";
  options: SelectOption[];
  /** Option values selected at first render. */
  default?: string[];
  /** Upper bound on selected options. */
  max?: number;
}

export interface NumberInput extends InputBase {
  type: "number";
  /** Shown after the field: "$", "%", "s", "words". */
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  /** Empty when omitted (formulas then see NaN and print "—"). */
  default?: number;
  placeholder?: string;
}

export interface ToggleInput extends InputBase {
  type: "toggle";
  default?: boolean;
  /** Labels on the switch, default "Yes" / "No". */
  onLabel?: string;
  offLabel?: string;
}

export interface DateInput extends InputBase {
  type: "date";
  /** Days from today used as the starting value (0 = today, -3 = three days ago). */
  defaultOffsetDays?: number;
}

export type InputDef = TextInput | TextareaInput | SelectInput | MultiselectInput | NumberInput | ToggleInput | DateInput;
/** The inputs a formula can read. */
export type NumericInputDef = NumberInput | SelectInput | ToggleInput | DateInput;

export interface When {
  input: string;
  is?: string | string[];
  not?: string | string[];
}

interface ToolBase {
  id: string;
  title: string;
  lede: string;
  ctaLabel?: string;
  ctaHref?: string;
  ctaNote?: string;
  schemaName?: string;
}

/* ─────────────────────────── generator ─────────────────────────── */

export interface VariantGroup {
  /** Shown as a tag on each output from this group, e.g. "Question hook". */
  label: string;
  /** Templates (see templating.ts for the placeholder syntax). */
  templates: string[];
  /** Use this group only when an input has (or lacks) a value; a list means every condition must hold. */
  when?: When | When[];
}

/**
 * Inputs → N text variants. Templates come from the variant groups that apply; the N shown
 * are chosen by a seed the seller can reshuffle ("Generate again"), spread across groups,
 * and rendered with the inputs. Rules: every `{{id}}` must name an input; filters must exist;
 * `lengthBudget.secondsInputId` must be a number or select input.
 */
export interface GeneratorTool extends ToolBase {
  kind: "generator";
  inputs: InputDef[];
  variants: VariantGroup[];
  /** Variants shown at once, 1–12, default 5. */
  count?: number;
  /** Show characters vs. this limit on every variant (headlines, bios with a hard cap). */
  charLimit?: number;
  /** Show words vs. the spoken budget (seconds input × words per second) on every variant. */
  lengthBudget?: { wordsPerSecond: number; secondsInputId: string };
  /** Button labels, default "Generate" / "Generate again". */
  generateLabel?: string;
  againLabel?: string;
}

/* ─────────────────────────── calculator ─────────────────────────── */

export interface CalcOutput {
  /** Identifier later outputs and the table may read. */
  id: string;
  label: string;
  /** Expression over input ids and earlier output ids (grammar in formulas.ts). */
  formula: string;
  format: OutputFormat;
  /** One line under the value: what it assumes. */
  note?: string;
  /** Shown large; default = the first output. */
  primary?: boolean;
}

export interface CalcTable {
  /** Heading above the table. */
  label?: string;
  /** Identifier the row's value is bound to inside column formulas. */
  rowVar: string;
  /** The row values, e.g. [10, 15, 20, 30, 45, 60]. */
  rows: number[];
  /** Header of the row column, e.g. "Seconds". */
  rowLabel: string;
  rowFormat: OutputFormat;
  columns: { label: string; formula: string; format: OutputFormat }[];
}

/**
 * Numeric inputs → outputs, recomputed on every keystroke. Rules: output ids are unique and
 * distinct from input ids; every formula parses; an output may only read inputs and outputs
 * listed before it; table column formulas may read inputs, every output and `rowVar`.
 */
export interface CalculatorTool extends ToolBase {
  kind: "calculator";
  inputs: NumericInputDef[];
  outputs: CalcOutput[];
  table?: CalcTable;
  /** Small print under the results: sources, assumptions. */
  note?: string;
}



/* ─────────────────────────── checker ─────────────────────────── */

export type Severity = "fatal" | "warn" | "info";

export interface CheckerRule {
  id: string;
  label: string;
  severity: Severity;
  /** Regular-expression source, tested globally against the text. */
  pattern: string;
  /** Subset of "imsu"; "i" is the usual choice. */
  flags?: string;
  /** What is wrong. */
  message: string;
  /** How to say it instead. */
  suggestion?: string;
}

export interface CheckerLimit {
  /** What is counted. */
  measure: "words" | "characters" | "paragraphs";
  /** Name of the target, e.g. "Common App personal statement". */
  label: string;
  min?: number;
  max: number;
  /** One line shown with the verdict: where the limit comes from. */
  note?: string;
}

/** "seconds@2.5" = spoken length at 2.5 words per second; "read@238" = silent reading time at 238 words per minute. */
export type CheckerStat = "words" | "sentences" | "characters" | "readingLevel" | `seconds@${number}` | `read@${number}`;

/**
 * Textarea → findings grouped by severity with the matches highlighted; rules are regexes.
 * `limits` turn the word or character count into a verdict (too short / within / too long).
 */
export interface CheckerTool extends ToolBase {
  kind: "checker";
  input: { label: string; placeholder?: string; maxLength?: number; default?: string; rows?: number };
  ruleSets: CheckerRule[];
  stats?: CheckerStat[];
  /** Length verdicts shown above the findings, e.g. words 250–400 for a cover letter. */
  limits?: CheckerLimit[];
  /** Heading of the all-clear state, default "No issues found". */
  successText?: string;
}

/* ─────────────────────────── quiz ─────────────────────────── */

export interface QuizOption {
  label: string;
  /** Points mode: added up, the total picks a result by `range`. */
  points?: number;
  /** Bucket mode: the most frequent bucket picks the result with that `bucket`. */
  bucket?: string;
}

export interface QuizQuestion {
  q: string;
  help?: string;
  options: QuizOption[];
}

export interface QuizResult {
  bucket?: string;
  /** Inclusive total-points range. */
  range?: [number, number];
  title: string;
  body: string;
  cta?: Cta;
}

/**
 * One question at a time with a progress bar, then a result pane with copy/share. Every
 * option must use the same mode (all `points` or all `bucket`); in points mode the ranges
 * must cover every reachable total without overlapping; in bucket mode every bucket named
 * by an option needs a result.
 */
export interface QuizTool extends ToolBase {
  kind: "quiz";
  questions: QuizQuestion[];
  results: QuizResult[];
  /** How the result is worked out, shown under it. */
  method?: string;
}

/* ─────────────────────────── decision ─────────────────────────── */

export interface DecisionNode {
  question: string;
  help?: string;
  /** `next` is a node id or a leaf id. */
  options: { label: string; next: string }[];
}

export interface DecisionLeaf {
  title: string;
  body: string;
  cta?: Cta;
}

/**
 * A tree walked one question at a time with a back button. Rules: `start` (default: the
 * first node) exists; every `next` names a node or a leaf; node and leaf ids do not overlap;
 * every node and leaf is reachable from the start.
 */
export interface DecisionTool extends ToolBase {
  kind: "decision";
  start?: string;
  nodes: Record<string, DecisionNode>;
  leaves: Record<string, DecisionLeaf>;
}

/* ─────────────────────────── checklist ─────────────────────────── */

export interface ChecklistItem {
  text: string;
  /** Small print under the item. */
  note?: string;
}

/** Sections of checkboxes; ticks persist in the browser (localStorage) per tool id. */
export interface ChecklistTool extends ToolBase {
  kind: "checklist";
  sections: { title: string; items: ChecklistItem[] }[];
}

/* ─────────────────────────── brief ─────────────────────────── */

export interface BriefSection {
  heading: string;
  /** Multi-line template; blank lines separate paragraphs, "- " starts a bullet. */
  template: string;
  /** A list means every condition must hold. */
  when?: When | When[];
}

/** Inputs → a structured document (headed sections) with "Copy as Markdown". Same template rules as the generator. */
export interface BriefTool extends ToolBase {
  kind: "brief";
  inputs: InputDef[];
  /** Template for the document title, default `title`. */
  docTitle?: string;
  sections: BriefSection[];
}

/* ─────────────────────────── teleprompter ─────────────────────────── */

/** A script box and a scrolling prompter that moves at a chosen words-per-minute pace. */
export interface TeleprompterTool extends ToolBase {
  kind: "teleprompter";
  input: { label: string; placeholder?: string; default?: string; maxLength?: number };
  /** Words per minute: starting value and the slider's range. */
  wpm: { default: number; min: number; max: number };
}


/* ─────────────────────────── keywords ─────────────────────────── */

/**
 * Two text boxes (a job description and a résumé). The tool pulls the phrases the posting
 * repeats or names as requirements, then shows which ones the résumé already uses and which
 * are missing. Runs in the browser; `extraStopwords` drops filler common to the field.
 */
export interface KeywordsTool extends ToolBase {
  kind: "keywords";
  source: { label: string; placeholder?: string; rows?: number };
  target: { label: string; placeholder?: string; rows?: number };
  /** Keywords listed at most, 10–60, default 30. */
  maxKeywords?: number;
  extraStopwords?: string[];
  note?: string;
}

/* ─────────────────────────── tracker ─────────────────────────── */

/**
 * An application tracker table kept in the browser (localStorage per tool id): company, role,
 * date applied, status, next step, link and notes; CSV export and import; rows whose status
 * is the first one and that are older than `followUpDays` are flagged for a follow-up.
 */
export interface TrackerTool extends ToolBase {
  kind: "tracker";
  /** Status options in pipeline order; the first is the status a new row starts with. */
  statuses: string[];
  followUpDays: number;
  /** Example rows shown until the visitor adds their own (cleared on first edit). */
  examples?: { company: string; role: string; daysAgo: number; status: string; next?: string }[];
  note?: string;
}

/* ─────────────────────────── finder ─────────────────────────── */

export interface FinderFacet {
  id: string;
  label: string;
  options: SelectOption[];
  /** Allow several options at once (default: one, plus "Any"). */
  multi?: boolean;
}

export interface FinderItem {
  title: string;
  /** One or two sentences; plain text. */
  body: string;
  /** Official page (https) for programs; omitted for advice items such as interview questions. */
  href?: string;
  /** Small line under the title: amount, deadline pattern, who runs it. */
  meta?: string;
  /** facet id → option values this item belongs to. An item without a facet key matches every option of it. */
  tags: Record<string, string[]>;
}

/**
 * Facet filters over a curated list. With `pick`, the visitor ticks up to that many items
 * and copies them as a list (e.g. five questions to ask an interviewer).
 */
export interface FinderTool extends ToolBase {
  kind: "finder";
  facets: FinderFacet[];
  items: FinderItem[];
  pick?: number;
  /** Shown above the list, e.g. "Checked against each program's official page on 2026-10-22." */
  note?: string;
  emptyText?: string;
}

export type Tool = GeneratorTool | CalculatorTool | CheckerTool | QuizTool | DecisionTool | ChecklistTool | BriefTool | TeleprompterTool | KeywordsTool | TrackerTool | FinderTool;

/* ═══════════════════════════ zod schema ═══════════════════════════ */

const ID = /^[a-z][A-Za-z0-9_]*$/;
const TOOL_ID = /^[a-z0-9][a-z0-9-]*$/;
const OUTPUT_FORMATS = ["usd", "pct", "int", "seconds", "words", "number", "precise", "yesno", "ratio", "date", "days"] as const;

const href = z.string().min(1).refine((h) => h.startsWith("/") || h.startsWith("https://"), "must be a site path (/…) or an https URL");
const cta = z.strictObject({ label: z.string().min(1), href });
const selectOption = z.strictObject({ value: z.string().min(1), label: z.string().min(1) });
const inputId = z.string().regex(ID, "input id: a letter, then letters, digits or underscores");
const whenOne = z.strictObject({
  input: inputId,
  is: z.union([z.string(), z.array(z.string())]).optional(),
  not: z.union([z.string(), z.array(z.string())]).optional(),
});
/** One condition, or a list of conditions that must all hold. */
const when = z.union([whenOne, z.array(whenOne).min(1).max(4)]);

const base = {
  id: inputId,
  label: z.string().min(1),
  help: z.string().optional(),
  when: when.optional(),
};
const textInput = z.strictObject({ ...base, type: z.literal("text"), placeholder: z.string().optional(), default: z.string().optional(), maxLength: z.number().int().positive().optional(), required: z.boolean().optional() });
const textareaInput = z.strictObject({
  ...base,
  type: z.literal("textarea"),
  placeholder: z.string().optional(),
  default: z.string().optional(),
  maxLength: z.number().int().positive().optional(),
  rows: z.number().int().min(2).max(20).optional(),
  required: z.boolean().optional(),
});
const selectInput = z.strictObject({ ...base, type: z.literal("select"), options: z.array(selectOption).min(2), default: z.string().optional(), display: z.enum(["chips", "dropdown"]).optional() });
const multiselectInput = z.strictObject({ ...base, type: z.literal("multiselect"), options: z.array(selectOption).min(2), default: z.array(z.string()).optional(), max: z.number().int().positive().optional() });
const numberInput = z.strictObject({
  ...base,
  type: z.literal("number"),
  unit: z.string().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().positive().optional(),
  default: z.number().optional(),
  placeholder: z.string().optional(),
});
const toggleInput = z.strictObject({ ...base, type: z.literal("toggle"), default: z.boolean().optional(), onLabel: z.string().optional(), offLabel: z.string().optional() });

const dateInput = z.strictObject({ ...base, type: z.literal("date"), defaultOffsetDays: z.number().int().min(-3650).max(3650).optional() });

const inputDef = z.discriminatedUnion("type", [textInput, textareaInput, selectInput, multiselectInput, numberInput, toggleInput, dateInput]);
const numericInputDef = z.discriminatedUnion("type", [numberInput, selectInput, toggleInput, dateInput]);

const toolBase = {
  id: z.string().regex(TOOL_ID, "tool id: lower-case letters, digits and hyphens"),
  title: z.string().min(1).max(90),
  lede: z.string().min(1).max(240),
  ctaLabel: z.string().min(1).max(60).optional(),
  ctaHref: href.optional(),
  ctaNote: z.string().max(160).optional(),
  schemaName: z.string().min(1).max(90).optional(),
};

const outputFormat = z.enum(OUTPUT_FORMATS);

const generatorSchema = z.strictObject({
  ...toolBase,
  kind: z.literal("generator"),
  inputs: z.array(inputDef).min(1),
  variants: z.array(z.strictObject({ label: z.string().min(1), templates: z.array(z.string().min(1)).min(1), when: when.optional() })).min(1),
  count: z.number().int().min(1).max(12).optional(),
  lengthBudget: z.strictObject({ wordsPerSecond: z.number().positive(), secondsInputId: inputId }).optional(),
  charLimit: z.number().int().min(20).max(5000).optional(),
  generateLabel: z.string().min(1).max(40).optional(),
  againLabel: z.string().min(1).max(40).optional(),
});

const calcOutput = z.strictObject({ id: inputId, label: z.string().min(1), formula: z.string().min(1), format: outputFormat, note: z.string().optional(), primary: z.boolean().optional() });
const calcTable = z.strictObject({
  label: z.string().optional(),
  rowVar: inputId,
  rows: z.array(z.number()).min(1).max(40),
  rowLabel: z.string().min(1),
  rowFormat: outputFormat,
  columns: z.array(z.strictObject({ label: z.string().min(1), formula: z.string().min(1), format: outputFormat })).min(1).max(6),
});

const calculatorSchema = z.strictObject({
  ...toolBase,
  kind: z.literal("calculator"),
  inputs: z.array(numericInputDef).min(1),
  outputs: z.array(calcOutput).min(1),
  table: calcTable.optional(),
  note: z.string().optional(),
});

const checkerRule = z.strictObject({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "rule id: lower-case letters, digits and hyphens"),
  label: z.string().min(1),
  severity: z.enum(["fatal", "warn", "info"]),
  pattern: z.string().min(1),
  flags: z.string().regex(/^[imsu]*$/, 'flags: any of "imsu"').optional(),
  message: z.string().min(1),
  suggestion: z.string().optional(),
});

const checkerStat = z.union([
  z.literal("words"),
  z.literal("sentences"),
  z.literal("characters"),
  z.literal("readingLevel"),
  z.custom<`seconds@${number}` | `read@${number}`>(
    (v) => typeof v === "string" && /^(?:seconds|read)@\d+(\.\d+)?$/.test(v),
    'stat: "words", "sentences", "characters", "readingLevel", "seconds@<words per second>" or "read@<words per minute>"',
  ),
]);

const checkerSchema = z.strictObject({
  ...toolBase,
  kind: z.literal("checker"),
  input: z.strictObject({ label: z.string().min(1), placeholder: z.string().optional(), maxLength: z.number().int().positive().optional(), default: z.string().optional(), rows: z.number().int().min(2).max(30).optional() }),
  ruleSets: z.array(checkerRule),
  stats: z.array(checkerStat).optional(),
  limits: z
    .array(z.strictObject({ measure: z.enum(["words", "characters", "paragraphs"]), label: z.string().min(1), min: z.number().int().nonnegative().optional(), max: z.number().int().positive(), note: z.string().optional() }))
    .max(6)
    .optional(),
  successText: z.string().optional(),
});

const quizSchema = z.strictObject({
  ...toolBase,
  kind: z.literal("quiz"),
  questions: z
    .array(
      z.strictObject({
        q: z.string().min(1),
        help: z.string().optional(),
        options: z.array(z.strictObject({ label: z.string().min(1), points: z.number().optional(), bucket: z.string().min(1).optional() })).min(2),
      }),
    )
    .min(1),
  results: z
    .array(
      z.strictObject({
        bucket: z.string().min(1).optional(),
        range: z.tuple([z.number(), z.number()]).optional(),
        title: z.string().min(1),
        body: z.string().min(1),
        cta: cta.optional(),
      }),
    )
    .min(1),
  method: z.string().optional(),
});

const decisionSchema = z.strictObject({
  ...toolBase,
  kind: z.literal("decision"),
  start: z.string().optional(),
  nodes: z.record(z.string().min(1), z.strictObject({ question: z.string().min(1), help: z.string().optional(), options: z.array(z.strictObject({ label: z.string().min(1), next: z.string().min(1) })).min(1) })),
  leaves: z.record(z.string().min(1), z.strictObject({ title: z.string().min(1), body: z.string().min(1), cta: cta.optional() })),
});

const checklistSchema = z.strictObject({
  ...toolBase,
  kind: z.literal("checklist"),
  sections: z.array(z.strictObject({ title: z.string().min(1), items: z.array(z.strictObject({ text: z.string().min(1), note: z.string().optional() })).min(1) })).min(1),
});

const briefSchema = z.strictObject({
  ...toolBase,
  kind: z.literal("brief"),
  inputs: z.array(inputDef).min(1),
  docTitle: z.string().optional(),
  sections: z.array(z.strictObject({ heading: z.string().min(1), template: z.string().min(1), when: when.optional() })).min(1),
});

const teleprompterSchema = z.strictObject({
  ...toolBase,
  kind: z.literal("teleprompter"),
  input: z.strictObject({ label: z.string().min(1), placeholder: z.string().optional(), default: z.string().optional(), maxLength: z.number().int().positive().optional() }),
  wpm: z.strictObject({ default: z.number().positive(), min: z.number().positive(), max: z.number().positive() }),
});


const boxSpec = z.strictObject({ label: z.string().min(1), placeholder: z.string().optional(), rows: z.number().int().min(3).max(30).optional() });
const keywordsSchema = z.strictObject({
  ...toolBase,
  kind: z.literal("keywords"),
  source: boxSpec,
  target: boxSpec,
  maxKeywords: z.number().int().min(10).max(60).optional(),
  extraStopwords: z.array(z.string().min(1)).optional(),
  note: z.string().optional(),
});

const trackerSchema = z.strictObject({
  ...toolBase,
  kind: z.literal("tracker"),
  statuses: z.array(z.string().min(1).max(30)).min(3).max(10),
  followUpDays: z.number().int().min(1).max(60),
  examples: z.array(z.strictObject({ company: z.string().min(1), role: z.string().min(1), daysAgo: z.number().int().min(0).max(365), status: z.string().min(1), next: z.string().optional() })).max(6).optional(),
  note: z.string().optional(),
});

const facetId = z.string().regex(ID, "facet id: a letter, then letters, digits or underscores");
const finderSchema = z.strictObject({
  ...toolBase,
  kind: z.literal("finder"),
  facets: z.array(z.strictObject({ id: facetId, label: z.string().min(1), options: z.array(selectOption).min(2), multi: z.boolean().optional() })).min(1).max(4),
  items: z
    .array(
      z.strictObject({
        title: z.string().min(1),
        body: z.string().min(1),
        href: z.string().regex(/^https:\/\//, "href must be an https URL").optional(),
        meta: z.string().optional(),
        tags: z.record(z.string(), z.array(z.string().min(1))),
      }),
    )
    .min(3),
  pick: z.number().int().min(1).max(12).optional(),
  note: z.string().optional(),
  emptyText: z.string().optional(),
});

/* ─────────────────────────── cross-field rules ─────────────────────────── */

type Ctx = z.RefinementCtx;
const issue = (ctx: Ctx, message: string, path: (string | number)[] = []) => ctx.addIssue({ code: "custom", message, path });

function checkInputs(inputs: InputDef[], ctx: Ctx, path: string): Set<string> {
  const ids = new Set<string>();
  inputs.forEach((inp, i) => {
    if (ids.has(inp.id)) issue(ctx, `duplicate input id "${inp.id}"`, [path, i, "id"]);
    ids.add(inp.id);
    if (inp.type === "select" || inp.type === "multiselect") {
      const values = inp.options.map((o) => o.value);
      if (new Set(values).size !== values.length) issue(ctx, "option values must be unique", [path, i, "options"]);
      if (inp.type === "select" && inp.default !== undefined && !values.includes(inp.default)) issue(ctx, `default "${inp.default}" is not an option value`, [path, i, "default"]);
      if (inp.type === "multiselect") for (const d of inp.default ?? []) if (!values.includes(d)) issue(ctx, `default "${d}" is not an option value`, [path, i, "default"]);
    }
    if (inp.type === "number" && inp.min !== undefined && inp.max !== undefined && inp.min > inp.max) issue(ctx, "min is greater than max", [path, i, "min"]);
  });
  inputs.forEach((inp, i) => {
    checkWhen(inp.when, ids, ctx, [path, i, "when"]);
    if ([inp.when ?? []].flat().some((w) => w.input === inp.id)) issue(ctx, "an input cannot be shown on a condition about itself", [path, i, "when"]);
  });
  return ids;
}

function checkTemplate(template: string, ids: Set<string>, ctx: Ctx, path: (string | number)[]) {
  for (const id of placeholderIds(template)) if (!ids.has(id)) issue(ctx, `template reads "{{${id}}}" but there is no input "${id}"`, path);
  for (const f of unknownFilters(template)) issue(ctx, `unknown filter "|${f}"`, path);
  for (const r of invalidRanges(template)) issue(ctx, `malformed range ${r} (use {{n:1-5}})`, path);
}

function checkWhen(w: When | When[] | undefined, ids: Set<string>, ctx: Ctx, path: (string | number)[]) {
  if (!w) return;
  if (Array.isArray(w)) {
    w.forEach((one, i) => checkWhen(one, ids, ctx, [...path, i]));
    return;
  }
  if (!ids.has(w.input)) issue(ctx, `condition reads input "${w.input}" which does not exist`, [...path, "input"]);
  if (w.is === undefined && w.not === undefined) issue(ctx, 'condition needs "is" or "not"', path);
}

function checkFormula(src: string, allowed: Set<string>, ctx: Ctx, path: (string | number)[]) {
  try {
    const c = compileFormula(src);
    for (const name of c.identifiers) if (!allowed.has(name)) issue(ctx, `formula reads "${name}", which is not an input${allowed.size ? ` (known: ${[...allowed].join(", ")})` : ""}`, path);
  } catch (e) {
    issue(ctx, e instanceof FormulaError ? `${e.message} at character ${e.position + 1} of "${src}"` : String(e), path);
  }
}

function refineGenerator(t: z.infer<typeof generatorSchema>, ctx: Ctx) {
  const ids = checkInputs(t.inputs, ctx, "inputs");
  t.variants.forEach((g, gi) => {
    g.templates.forEach((tpl, ti) => checkTemplate(tpl, ids, ctx, ["variants", gi, "templates", ti]));
    checkWhen(g.when, ids, ctx, ["variants", gi, "when"]);
  });
  if (t.lengthBudget) {
    const inp = t.inputs.find((i) => i.id === t.lengthBudget!.secondsInputId);
    if (!inp) issue(ctx, `secondsInputId "${t.lengthBudget.secondsInputId}" is not an input`, ["lengthBudget", "secondsInputId"]);
    else if (inp.type !== "number" && inp.type !== "select") issue(ctx, "secondsInputId must be a number or select input", ["lengthBudget", "secondsInputId"]);
  }
}

function refineCalculator(t: z.infer<typeof calculatorSchema>, ctx: Ctx) {
  const ids = checkInputs(t.inputs, ctx, "inputs");
  const known = new Set(ids);
  t.outputs.forEach((o, i) => {
    if (known.has(o.id)) issue(ctx, `output id "${o.id}" is already an input or an earlier output`, ["outputs", i, "id"]);
    checkFormula(o.formula, known, ctx, ["outputs", i, "formula"]);
    known.add(o.id);
  });
  if (t.table) {
    if (known.has(t.table.rowVar)) issue(ctx, `rowVar "${t.table.rowVar}" clashes with an input or output`, ["table", "rowVar"]);
    const rowScope = new Set([...known, t.table.rowVar]);
    t.table.columns.forEach((c, i) => checkFormula(c.formula, rowScope, ctx, ["table", "columns", i, "formula"]));
  }
}

function refineChecker(t: z.infer<typeof checkerSchema>, ctx: Ctx) {
  const ids = new Set<string>();
  if (!t.ruleSets.length && !t.limits?.length && !t.stats?.length) issue(ctx, "a checker needs rules, limits or stats", ["ruleSets"]);
  t.ruleSets.forEach((r, i) => {
    if (ids.has(r.id)) issue(ctx, `duplicate rule id "${r.id}"`, ["ruleSets", i, "id"]);
    ids.add(r.id);
    try {
      new RegExp(r.pattern, `g${r.flags ?? ""}`);
    } catch (e) {
      issue(ctx, `pattern does not compile: ${(e as Error).message}`, ["ruleSets", i, "pattern"]);
    }
  });
}

/** Every total a points quiz can reach (questions are few, so the set stays small). */
function reachableTotals(questions: QuizQuestion[]): number[] {
  let totals = new Set<number>([0]);
  for (const q of questions) {
    const next = new Set<number>();
    for (const t of totals) for (const o of q.options) next.add(t + (o.points ?? 0));
    totals = next;
  }
  return [...totals].sort((a, b) => a - b);
}

function refineQuiz(t: z.infer<typeof quizSchema>, ctx: Ctx) {
  const options = t.questions.flatMap((q) => q.options);
  const hasPoints = options.some((o) => o.points !== undefined);
  const hasBuckets = options.some((o) => o.bucket !== undefined);
  if (hasPoints && hasBuckets) return issue(ctx, 'mixing "points" and "bucket" options: use one mode for the whole quiz', ["questions"]);
  if (!hasPoints && !hasBuckets) return issue(ctx, 'every option needs "points" or "bucket"', ["questions"]);
  if (hasBuckets) {
    options.forEach((o) => {
      if (o.bucket === undefined) issue(ctx, 'bucket mode: every option needs a "bucket"', ["questions"]);
    });
    const buckets = new Set(options.map((o) => o.bucket).filter((b): b is string => b !== undefined));
    const covered = new Set<string>();
    t.results.forEach((r, i) => {
      if (!r.bucket) return issue(ctx, 'bucket mode: every result needs a "bucket"', ["results", i]);
      if (covered.has(r.bucket)) issue(ctx, `two results for bucket "${r.bucket}"`, ["results", i, "bucket"]);
      covered.add(r.bucket);
      if (!buckets.has(r.bucket)) issue(ctx, `no option uses bucket "${r.bucket}"`, ["results", i, "bucket"]);
    });
    for (const b of buckets) if (!covered.has(b)) issue(ctx, `bucket "${b}" has no result`, ["results"]);
    return;
  }
  options.forEach((o) => {
    if (o.points === undefined) issue(ctx, 'points mode: every option needs "points"', ["questions"]);
  });
  const ranges: [number, number][] = [];
  t.results.forEach((r, i) => {
    if (!r.range) return issue(ctx, 'points mode: every result needs a "range"', ["results", i]);
    if (r.range[0] > r.range[1]) issue(ctx, "range must be [low, high]", ["results", i, "range"]);
    for (const other of ranges) if (r.range[0] <= other[1] && other[0] <= r.range[1]) issue(ctx, `range [${r.range}] overlaps [${other}]`, ["results", i, "range"]);
    ranges.push(r.range);
  });
  for (const total of reachableTotals(t.questions)) {
    if (!ranges.some(([lo, hi]) => total >= lo && total <= hi)) issue(ctx, `a total of ${total} points matches no result range`, ["results"]);
  }
}

function refineDecision(t: z.infer<typeof decisionSchema>, ctx: Ctx) {
  const nodeIds = Object.keys(t.nodes);
  const leafIds = Object.keys(t.leaves);
  if (!nodeIds.length) return issue(ctx, "at least one node is required", ["nodes"]);
  for (const id of leafIds) if (id in t.nodes) issue(ctx, `"${id}" is both a node and a leaf`, ["leaves", id]);
  const start = t.start ?? nodeIds[0];
  if (!(start in t.nodes)) issue(ctx, `start "${start}" is not a node`, ["start"]);
  const seen = new Set<string>();
  const stack = start in t.nodes ? [start] : [];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const node = t.nodes[id];
    if (!node) continue;
    node.options.forEach((o, oi) => {
      if (!(o.next in t.nodes) && !(o.next in t.leaves)) issue(ctx, `"${o.next}" is neither a node nor a leaf`, ["nodes", id, "options", oi, "next"]);
      else stack.push(o.next);
    });
  }
  for (const id of [...nodeIds, ...leafIds]) if (!seen.has(id)) issue(ctx, `"${id}" can never be reached from "${start}"`, [id in t.nodes ? "nodes" : "leaves", id]);
}

function refineBrief(t: z.infer<typeof briefSchema>, ctx: Ctx) {
  const ids = checkInputs(t.inputs, ctx, "inputs");
  if (t.docTitle) checkTemplate(t.docTitle, ids, ctx, ["docTitle"]);
  t.sections.forEach((s, i) => {
    checkTemplate(s.heading, ids, ctx, ["sections", i, "heading"]);
    checkTemplate(s.template, ids, ctx, ["sections", i, "template"]);
    checkWhen(s.when, ids, ctx, ["sections", i, "when"]);
  });
}

function refineTeleprompter(t: z.infer<typeof teleprompterSchema>, ctx: Ctx) {
  if (t.wpm.min > t.wpm.max) issue(ctx, "wpm.min must not exceed wpm.max", ["wpm"]);
  if (t.wpm.default < t.wpm.min || t.wpm.default > t.wpm.max) issue(ctx, "wpm.default must lie between min and max", ["wpm", "default"]);
}

function refineTracker(t: z.infer<typeof trackerSchema>, ctx: Ctx) {
  if (new Set(t.statuses).size !== t.statuses.length) issue(ctx, "status names must be unique", ["statuses"]);
  (t.examples ?? []).forEach((e, i) => {
    if (!t.statuses.includes(e.status)) issue(ctx, `example status "${e.status}" is not in statuses`, ["examples", i, "status"]);
  });
}

function refineFinder(t: z.infer<typeof finderSchema>, ctx: Ctx) {
  const facets = new Map(t.facets.map((f) => [f.id, new Set(f.options.map((o) => o.value))]));
  if (facets.size !== t.facets.length) issue(ctx, "facet ids must be unique", ["facets"]);
  t.items.forEach((it, i) => {
    for (const [k, vals] of Object.entries(it.tags)) {
      const opts = facets.get(k);
      if (!opts) issue(ctx, `tag "${k}" is not a facet id`, ["items", i, "tags", k]);
      else for (const v of vals) if (!opts.has(v)) issue(ctx, `"${v}" is not an option of facet "${k}"`, ["items", i, "tags", k]);
    }
  });
  for (const f of t.facets) for (const o of f.options) if (!t.items.some((it) => !it.tags[f.id] || it.tags[f.id].includes(o.value))) issue(ctx, `option "${o.value}" of facet "${f.id}" matches no item`, ["facets"]);
}

export const ToolSchema = z
  .discriminatedUnion("kind", [generatorSchema, calculatorSchema, checkerSchema, quizSchema, decisionSchema, checklistSchema, briefSchema, teleprompterSchema, keywordsSchema, trackerSchema, finderSchema])
  .superRefine((t, ctx) => {
    switch (t.kind) {
      case "generator":
        return refineGenerator(t, ctx);
      case "calculator":
        return refineCalculator(t, ctx);
      case "checker":
        return refineChecker(t, ctx);
      case "quiz":
        return refineQuiz(t, ctx);
      case "decision":
        return refineDecision(t, ctx);
      case "brief":
        return refineBrief(t, ctx);
      case "teleprompter":
        return refineTeleprompter(t, ctx);
      case "tracker":
        return refineTracker(t, ctx);
      case "finder":
        return refineFinder(t, ctx);
      default:
        return;
    }
  });

/* The interfaces above are the documentation; this line fails to compile if they drift from the schema. */
type Equals<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
export const TOOL_TYPES_MATCH_SCHEMA: Equals<Tool, z.infer<typeof ToolSchema>> = true;

/**
 * Validates one parsed JSON document. Returns the typed tool or throws an Error whose
 * message lists every problem with its path, prefixed with `file` when given.
 */
export function validateTool(data: unknown, file?: string): Tool {
  const r = ToolSchema.safeParse(data);
  if (r.success) return r.data;
  const lines = r.error.issues.map((i) => `  ${i.path.length ? i.path.join(".") : "(root)"}: ${i.message}`);
  throw new Error(`${file ? `${file}: ` : ""}invalid tool definition\n${lines.join("\n")}`);
}

/** Effective call to action for a tool (defaults applied). */
export function toolCta(tool: Tool): { label: string; href: string; note?: string } {
  return { label: tool.ctaLabel ?? DEFAULT_CTA_LABEL, href: tool.ctaHref ?? DEFAULT_CTA_HREF, ...(tool.ctaNote ? { note: tool.ctaNote } : {}) };
}
