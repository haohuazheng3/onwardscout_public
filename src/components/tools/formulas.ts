/*
 * Safe arithmetic for calculator and converter tools. A formula is a short expression in
 * the tool's JSON ("round(seconds * pace)", "price * (1 - fee / 100)"), parsed into a tree
 * once and evaluated on every keystroke against the input values. Nothing is eval'd and
 * nothing outside the grammar below can run.
 *
 * Grammar (lowest precedence first):
 *   comparison   a < b   a <= b   a > b   a >= b   a == b   a != b     → 1 or 0
 *   additive     a + b   a - b
 *   term         a * b   a / b   a % b
 *   power        a ^ b   (right-associative)
 *   unary        -a   +a
 *   primary      number · name · fn(args) · ( expr )
 *
 * Numbers: 12, 1.5, .5, 2e3. Names: input ids, outputs computed earlier in the same tool,
 * and the table's row variable. Functions: min, max, round(x [, digits]), ceil, floor, abs,
 * sqrt, clamp(x, lo, hi), if(cond, whenTrue, whenFalse), and for dates (days since 1970-01-01):
 * weekday(d) (0 = Monday … 6 = Sunday), isWeekend(d), addWorkdays(d, n); log1mc(x) = ln(1 − x). Division by zero gives Infinity
 * and an empty input gives NaN; the renderer prints both as "—".
 */

export class FormulaError extends Error {
  constructor(
    message: string,
    public readonly position: number,
  ) {
    super(message);
    this.name = "FormulaError";
  }
}

export type Ast =
  | { t: "num"; v: number }
  | { t: "id"; name: string; pos: number }
  | { t: "neg"; a: Ast }
  | { t: "bin"; op: "+" | "-" | "*" | "/" | "%" | "^" | "<" | "<=" | ">" | ">=" | "==" | "!="; a: Ast; b: Ast }
  | { t: "call"; fn: string; args: Ast[]; pos: number };

type Token = { kind: "num"; value: number; pos: number } | { kind: "id"; value: string; pos: number } | { kind: "op"; value: string; pos: number } | { kind: "end"; pos: number };

export const FUNCTIONS: Record<string, { arity: [number, number]; fn: (...a: number[]) => number }> = {
  min: { arity: [1, 64], fn: (...a) => Math.min(...a) },
  max: { arity: [1, 64], fn: (...a) => Math.max(...a) },
  round: {
    arity: [1, 2],
    fn: (x, digits = 0) => {
      const m = 10 ** Math.max(0, Math.floor(digits));
      return Math.round((x + Number.EPSILON) * m) / m;
    },
  },
  ceil: { arity: [1, 1], fn: (x) => Math.ceil(x) },
  floor: { arity: [1, 1], fn: (x) => Math.floor(x) },
  abs: { arity: [1, 1], fn: (x) => Math.abs(x) },
  sqrt: { arity: [1, 1], fn: (x) => Math.sqrt(x) },
  clamp: { arity: [3, 3], fn: (x, lo, hi) => Math.min(Math.max(x, lo), hi) },
  if: { arity: [3, 3], fn: (c, a, b) => (c ? a : b) },
  /** Natural log of (1 − x), for "at least one success in n tries" maths: n = log1mc(confidence) / log1mc(p). */
  log1mc: { arity: [1, 1], fn: (x) => (x < 1 ? Math.log(1 - x) : NaN) },
  /**
   * Smallest number of independent tries n with P(at least k successes) ≥ conf when each try
   * succeeds with probability p (binomial): trials(1, 0.2, 0.9) = 11, trials(2, 0.2, 0.9) = 18.
   * NaN outside 0 < p < 1, 0 < conf < 1, 1 ≤ k ≤ 20, or when more than 5,000 tries would be needed.
   */
  trials: {
    arity: [3, 3],
    fn: (k, p, conf) => {
      const want = Math.round(k);
      if (!(p > 0 && p < 1 && conf > 0 && conf < 1 && want >= 1 && want <= 20)) return NaN;
      for (let n = want; n <= 5000; n++) {
        // P(X < want) = Σ_{i<want} C(n,i) p^i (1−p)^(n−i), built term by term in log space.
        let below = 0;
        let logC = 0;
        for (let i = 0; i < want; i++) {
          if (i > 0) logC += Math.log(n - i + 1) - Math.log(i);
          below += Math.exp(logC + i * Math.log(p) + (n - i) * Math.log(1 - p));
        }
        if (1 - below >= conf - 1e-12) return n;
      }
      return NaN;
    },
  },
  /** Day of the week of a date given as days since 1970-01-01 (a Thursday): 0 = Monday … 6 = Sunday. */
  weekday: { arity: [1, 1], fn: (d) => (Number.isFinite(d) ? (((Math.floor(d) + 3) % 7) + 7) % 7 : NaN) },
  /** 1 when the date is a Saturday or Sunday. */
  isWeekend: { arity: [1, 1], fn: (d) => (Number.isFinite(d) ? ((((Math.floor(d) + 3) % 7) + 7) % 7 >= 5 ? 1 : 0) : NaN) },
  /** The date n working days (Monday–Friday) after d; n may be negative. */
  addWorkdays: {
    arity: [2, 2],
    fn: (d, n) => {
      if (!Number.isFinite(d) || !Number.isFinite(n)) return NaN;
      let day = Math.floor(d);
      let left = Math.round(Math.abs(n));
      const step = n < 0 ? -1 : 1;
      while (left > 0) {
        day += step;
        const wd = (((day + 3) % 7) + 7) % 7;
        if (wd < 5) left--;
      }
      return day;
    },
  },
  /** Greatest common divisor of two whole numbers (inputs are rounded); gcd(1080, 1920) = 120. */
  gcd: {
    arity: [2, 2],
    fn: (x, y) => {
      let a = Math.abs(Math.round(x));
      let b = Math.abs(Math.round(y));
      if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN;
      while (b) [a, b] = [b, a % b];
      return a;
    },
  },
};

const TWO_CHAR_OPS = new Set(["<=", ">=", "==", "!="]);
const ONE_CHAR_OPS = new Set(["+", "-", "*", "/", "%", "^", "(", ")", ",", "<", ">"]);

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (TWO_CHAR_OPS.has(two)) {
      out.push({ kind: "op", value: two, pos: i });
      i += 2;
      continue;
    }
    if (ONE_CHAR_OPS.has(c)) {
      out.push({ kind: "op", value: c, pos: i });
      i++;
      continue;
    }
    const num = /^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i.exec(src.slice(i));
    if (num) {
      out.push({ kind: "num", value: Number(num[0]), pos: i });
      i += num[0].length;
      continue;
    }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
    if (id) {
      out.push({ kind: "id", value: id[0], pos: i });
      i += id[0].length;
      continue;
    }
    throw new FormulaError(`Unexpected character "${c}"`, i);
  }
  out.push({ kind: "end", pos: src.length });
  return out;
}

class Parser {
  private i = 0;
  constructor(private readonly tokens: Token[]) {}

  private peek(): Token {
    return this.tokens[this.i];
  }
  private next(): Token {
    return this.tokens[this.i++];
  }
  private isOp(value: string): boolean {
    const t = this.peek();
    return t.kind === "op" && t.value === value;
  }
  private expectOp(value: string): void {
    const t = this.next();
    if (t.kind !== "op" || t.value !== value) throw new FormulaError(`Expected "${value}"`, t.pos);
  }

  parse(): Ast {
    const ast = this.comparison();
    const t = this.peek();
    if (t.kind !== "end") throw new FormulaError(`Unexpected "${t.kind === "op" || t.kind === "id" ? t.value : t.kind === "num" ? t.value : ""}"`, t.pos);
    return ast;
  }

  private comparison(): Ast {
    let a = this.additive();
    for (;;) {
      const t = this.peek();
      if (t.kind === "op" && (t.value === "<" || t.value === "<=" || t.value === ">" || t.value === ">=" || t.value === "==" || t.value === "!=")) {
        this.next();
        a = { t: "bin", op: t.value, a, b: this.additive() };
      } else return a;
    }
  }

  private additive(): Ast {
    let a = this.term();
    for (;;) {
      if (this.isOp("+") || this.isOp("-")) {
        const op = (this.next() as { value: "+" | "-" }).value;
        a = { t: "bin", op, a, b: this.term() };
      } else return a;
    }
  }

  private term(): Ast {
    let a = this.unary();
    for (;;) {
      if (this.isOp("*") || this.isOp("/") || this.isOp("%")) {
        const op = (this.next() as { value: "*" | "/" | "%" }).value;
        a = { t: "bin", op, a, b: this.unary() };
      } else return a;
    }
  }

  // Unary minus binds looser than ^ ("-2 ^ 2" is -4), and the exponent may itself be signed ("2 ^ -1").
  private unary(): Ast {
    if (this.isOp("-")) {
      this.next();
      return { t: "neg", a: this.unary() };
    }
    if (this.isOp("+")) {
      this.next();
      return this.unary();
    }
    return this.power();
  }

  private power(): Ast {
    const a = this.primary();
    if (this.isOp("^")) {
      this.next();
      return { t: "bin", op: "^", a, b: this.unary() };
    }
    return a;
  }

  private primary(): Ast {
    const t = this.next();
    if (t.kind === "num") return { t: "num", v: t.value };
    if (t.kind === "id") {
      if (this.isOp("(")) {
        this.next();
        const args: Ast[] = [];
        if (!this.isOp(")")) {
          args.push(this.comparison());
          while (this.isOp(",")) {
            this.next();
            args.push(this.comparison());
          }
        }
        this.expectOp(")");
        const fn = FUNCTIONS[t.value];
        if (!fn) throw new FormulaError(`Unknown function "${t.value}"`, t.pos);
        if (args.length < fn.arity[0] || args.length > fn.arity[1]) {
          throw new FormulaError(`${t.value}() takes ${fn.arity[0] === fn.arity[1] ? fn.arity[0] : `${fn.arity[0]} to ${fn.arity[1]}`} argument(s)`, t.pos);
        }
        return { t: "call", fn: t.value, args, pos: t.pos };
      }
      return { t: "id", name: t.value, pos: t.pos };
    }
    if (t.kind === "op" && t.value === "(") {
      const inner = this.comparison();
      this.expectOp(")");
      return inner;
    }
    throw new FormulaError(t.kind === "end" ? "Unexpected end of formula" : `Unexpected "${t.value}"`, t.pos);
  }
}

/** Parses once; throws FormulaError with the character position when the text is not a formula. */
export function parseFormula(src: string): Ast {
  if (!src.trim()) throw new FormulaError("Empty formula", 0);
  return new Parser(tokenize(src)).parse();
}

/** Names the formula reads, in order of first use. */
export function formulaIdentifiers(ast: Ast): string[] {
  const out: string[] = [];
  const walk = (n: Ast) => {
    switch (n.t) {
      case "id":
        if (!out.includes(n.name)) out.push(n.name);
        break;
      case "neg":
        walk(n.a);
        break;
      case "bin":
        walk(n.a);
        walk(n.b);
        break;
      case "call":
        n.args.forEach(walk);
        break;
      default:
        break;
    }
  };
  walk(ast);
  return out;
}

export type Scope = Record<string, number>;

export function evaluateAst(ast: Ast, scope: Scope): number {
  switch (ast.t) {
    case "num":
      return ast.v;
    case "id": {
      // Own properties only: "toString" or "__proto__" must never resolve through the prototype.
      if (!Object.prototype.hasOwnProperty.call(scope, ast.name)) throw new FormulaError(`Unknown name "${ast.name}"`, ast.pos);
      return scope[ast.name];
    }
    case "neg":
      return -evaluateAst(ast.a, scope);
    case "bin": {
      const a = evaluateAst(ast.a, scope);
      const b = evaluateAst(ast.b, scope);
      switch (ast.op) {
        case "+":
          return a + b;
        case "-":
          return a - b;
        case "*":
          return a * b;
        case "/":
          return a / b;
        case "%":
          return a % b;
        case "^":
          return a ** b;
        case "<":
          return a < b ? 1 : 0;
        case "<=":
          return a <= b ? 1 : 0;
        case ">":
          return a > b ? 1 : 0;
        case ">=":
          return a >= b ? 1 : 0;
        case "==":
          return a === b ? 1 : 0;
        case "!=":
          return a !== b ? 1 : 0;
        default:
          return NaN;
      }
    }
    case "call": {
      const fn = FUNCTIONS[ast.fn];
      if (!fn) throw new FormulaError(`Unknown function "${ast.fn}"`, ast.pos);
      return fn.fn(...ast.args.map((a) => evaluateAst(a, scope)));
    }
    default:
      return NaN;
  }
}

export interface CompiledFormula {
  source: string;
  identifiers: string[];
  evaluate(scope: Scope): number;
}

/** Parse + identifiers in one step; the tool views compile every formula once per tool. */
export function compileFormula(src: string): CompiledFormula {
  const ast = parseFormula(src);
  return { source: src, identifiers: formulaIdentifiers(ast), evaluate: (scope) => evaluateAst(ast, scope) };
}

/** One-shot helper for tests and scripts. */
export function evaluateFormula(src: string, scope: Scope = {}): number {
  return evaluateAst(parseFormula(src), scope);
}

/** "yesno": a comparison result (non-zero = Yes). "precise": up to four decimals, for ratios like 0.5625. "ratio": a width ÷ height value printed as its simplest W:H (0.5625 → 9:16). */
export type OutputFormat = "usd" | "pct" | "int" | "seconds" | "words" | "number" | "precise" | "yesno" | "ratio" | "date" | "days";

const DAY_MS = 86_400_000;

/** Today in the visitor's time zone as days since 1970-01-01 (the value a date input holds). */
export function todayDays(now: Date = new Date()): number {
  return Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / DAY_MS);
}

/** Days since 1970-01-01 → "Tue 28 Oct 2026". */
export function formatDay(days: number): string {
  if (!Number.isFinite(days)) return "—";
  return new Date(Math.floor(days) * DAY_MS).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).replace(/,/g, "");
}

/** Days since 1970-01-01 → "Monday, October 19" (how a date reads inside an email or letter). */
export function formatDayLong(days: number): string {
  if (!Number.isFinite(days)) return "";
  return new Date(Math.floor(days) * DAY_MS).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
}

/** Days since 1970-01-01 ↔ "YYYY-MM-DD" (the value of an <input type="date">). */
export function dayToIso(days: number): string {
  return Number.isFinite(days) ? new Date(Math.floor(days) * DAY_MS).toISOString().slice(0, 10) : "";
}
export function isoToDay(iso: string): number {
  const t = Date.parse(`${iso}T00:00:00Z`);
  return Number.isNaN(t) ? NaN : Math.floor(t / DAY_MS);
}

/** Simplest W:H for a positive decimal, by continued fractions (exact for ratios of whole pixel sizes). */
export function toRatio(x: number): string {
  if (!Number.isFinite(x) || x <= 0) return "—";
  let [h1, h0, k1, k0] = [1, 0, 0, 1];
  let b = x;
  for (let i = 0; i < 64; i++) {
    const a = Math.floor(b);
    [h1, h0] = [a * h1 + h0, h1];
    [k1, k0] = [a * k1 + k0, k1];
    if (Math.abs(h1 / k1 - x) <= 1e-9 * Math.max(1, x) || k1 > 100000) break;
    const frac = b - a;
    if (frac < 1e-12) break;
    b = 1 / frac;
  }
  return `${h1}:${k1}`;
}

/** Human formatting for computed values; non-finite values print as an em dash. */
export function formatValue(value: number, format: OutputFormat): string {
  if (!Number.isFinite(value)) return "—";
  const us = (n: number, max: number) => n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: max });
  switch (format) {
    case "usd": {
      const abs = Math.abs(value);
      const body = Number.isInteger(abs) ? us(abs, 0) : abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return `${value < 0 ? "−" : ""}$${body}`;
    }
    case "pct":
      return `${us(value, 1)}%`;
    case "int":
      return us(Math.round(value), 0);
    case "seconds":
      return `${us(value, 1)} s`;
    case "words": {
      const n = Math.round(value);
      return `${us(n, 0)} ${n === 1 ? "word" : "words"}`;
    }
    case "precise":
      return us(value, 4);
    case "yesno":
      return value !== 0 ? "Yes" : "No";
    case "ratio":
      return toRatio(value);
    case "date":
      return formatDay(value);
    case "days": {
      const n = Math.round(value);
      return `${us(n, 0)} ${Math.abs(n) === 1 ? "day" : "days"}`;
    }
    default:
      return us(value, 2);
  }
}
