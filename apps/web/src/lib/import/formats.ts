// Turns an export from Monarch, Copilot, Mint, YNAB, or a bank into normalized rows.
//
// Known exports (headers lower-cased):
//   Monarch  date, merchant, category, account, original statement, notes, amount, tags[, owner]
//            ISO dates, negative = money out.
//   Copilot  date, name, amount, status, category, parent category, excluded, tags, type,
//            account, account mask, note, recurring. Sign is inferred from `type = income` rows.
//   Mint     date, description, original description, amount, transaction type, category,
//            account name, labels, notes. Amount is unsigned; transaction type is debit/credit.
//   YNAB     account, flag, date, payee, category group/category, category group, category,
//            memo, outflow, inflow, cleared.
// Anything else is read as a generic bank CSV by finding date, description and amount
// (or debit/credit) columns.

import { csvRecords } from "./csv";
import type { Format, Kind, ParseResult, Txn } from "./types";

type Row = Record<string, string>;

type Raw = {
  date: string;
  /** Amount as written in the file. */
  value: number;
  /** +1 when the file's positive means money out, -1 when it means money in, 0 when unknown. */
  polarity: 1 | -1 | 0;
  name: string;
  description?: string;
  category?: string;
  accountLabel?: string;
  accountMask?: string;
  pending?: boolean;
  excluded?: boolean;
  transferHint?: boolean;
  incomeHint?: boolean;
};

export function detectFormat(headers: string[]): Format {
  const has = (...h: string[]) => h.every((x) => headers.includes(x));
  if (has("merchant", "original statement", "amount")) return "monarch";
  if (has("name", "amount") && (headers.includes("parent category") || headers.includes("account mask") || headers.includes("excluded")))
    return "copilot";
  if (has("description", "original description", "transaction type")) return "mint";
  if (has("payee", "outflow", "inflow")) return "ynab";
  return "csv";
}

/**
 * `flip` reverses a guessed sign convention, for when the user says "those are backwards".
 * It never touches formats whose sign is known.
 */
export function parseExport(text: string, opts: { format?: Format; flip?: boolean } = {}): ParseResult {
  const { headers, records } = csvRecords(text);
  const format = opts.format ?? detectFormat(headers);
  const read = READERS[format === "csv" ? "csv" : format];
  const generic = format === "csv" ? genericColumns(headers) : undefined;
  if (format === "csv" && !generic) {
    return { format, txns: [], skipped: [{ row: 1, reason: "Could not find date, description and amount columns" }], signGuessed: false };
  }

  const raws: (Raw & { row: number })[] = [];
  const skipped: ParseResult["skipped"] = [];
  records.forEach((r, i) => {
    const row = i + 2; // 1-based, after the header
    try {
      const raw = read(r, generic!);
      if (!raw) return;
      raws.push({ ...raw, row });
    } catch (e) {
      skipped.push({ row, reason: (e as Error).message });
    }
  });

  const resolved = resolvePolarity(raws);
  const polarity = opts.flip ? (-resolved.polarity as 1 | -1) : resolved.polarity;
  const guessed = resolved.guessed;
  const seen = new Map<string, number>();
  const txns = raws.map((r): Txn => {
    const p = r.polarity || polarity;
    const amount = round2(r.value * p);
    const base = [r.accountMask ?? r.accountLabel ?? "", r.date, amount.toFixed(2), r.name, r.description ?? ""].join("|");
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return {
      source: format,
      sourceTxnId: `${hash(base)}-${n}`,
      date: r.date,
      amount,
      name: r.name,
      description: r.description || undefined,
      category: r.category || undefined,
      accountLabel: r.accountLabel || undefined,
      accountMask: r.accountMask || undefined,
      pending: r.pending || undefined,
      kind: classify(r, amount),
    };
  });

  return { format, txns, skipped, signGuessed: guessed };
}

// ---------------------------------------------------------------------------------------
// Readers

type Columns = { date: string; name: string; amount?: string; debit?: string; credit?: string; category?: string; account?: string };

const READERS: Record<Format, (r: Row, cols: Columns) => Raw | null> = {
  monarch: (r) => ({
    date: parseDate(r["date"]),
    value: parseAmount(r["amount"]),
    polarity: -1,
    name: r["merchant"] || r["original statement"],
    description: r["original statement"],
    category: r["category"],
    ...splitAccount(r["account"]),
  }),

  copilot: (r) => {
    const type = (r["type"] ?? "").toLowerCase();
    return {
      date: parseDate(r["date"]),
      value: parseAmount(r["amount"]),
      polarity: 0,
      name: r["name"],
      category: r["category"] || r["parent category"],
      accountLabel: r["account"],
      accountMask: digits(r["account mask"]),
      pending: /pending/i.test(r["status"] ?? ""),
      excluded: /^true$/i.test(r["excluded"] ?? ""),
      transferHint: type.includes("transfer"),
      incomeHint: type === "income",
    };
  },

  mint: (r) => ({
    date: parseDate(r["date"]),
    value: Math.abs(parseAmount(r["amount"])),
    polarity: /credit/i.test(r["transaction type"]) ? -1 : 1,
    name: r["description"],
    description: r["original description"],
    category: r["category"],
    accountLabel: r["account name"],
  }),

  ynab: (r) => {
    const out = parseAmount(r["outflow"] || "0");
    const inn = parseAmount(r["inflow"] || "0");
    const payee = r["payee"] ?? "";
    return {
      date: parseDate(r["date"]),
      value: out - inn,
      polarity: 1,
      name: payee,
      description: r["memo"],
      category: r["category"],
      accountLabel: r["account"],
      transferHint: /^transfer\s*:/i.test(payee),
      incomeHint: /ready to assign|inflow/i.test(r["category"] ?? ""),
    };
  },

  csv: (r, c) => {
    const date = parseDate(r[c.date]);
    let value: number;
    let polarity: Raw["polarity"] = 0;
    if (c.amount && r[c.amount] !== "") value = parseAmount(r[c.amount]);
    else {
      const d = c.debit && r[c.debit] ? Math.abs(parseAmount(r[c.debit])) : 0;
      const cr = c.credit && r[c.credit] ? Math.abs(parseAmount(r[c.credit])) : 0;
      value = d - cr;
      polarity = 1;
    }
    return {
      date,
      value,
      polarity,
      name: r[c.name],
      category: c.category ? r[c.category] : undefined,
      ...(c.account ? splitAccount(r[c.account]) : {}),
    };
  },
};

function genericColumns(headers: string[]): Columns | undefined {
  const find = (re: RegExp, not?: RegExp) => headers.find((h) => re.test(h) && !(not && not.test(h)));
  const date = find(/^(transaction |trans\.? |posted |posting )?date$/) ?? find(/date/, /value date/);
  const name = find(/^(description|payee|merchant|name)$/) ?? find(/description|payee|merchant|memo|details|name/);
  const amount = find(/^amount$/) ?? find(/amount/, /balance/);
  const debit = find(/debit|withdrawal|money out|paid out/);
  const credit = find(/credit|deposit|money in|paid in/, /credit card/);
  if (!date || !name || !(amount || debit || credit)) return undefined;
  return { date, name, amount, debit, credit, category: find(/categor/), account: find(/^account( name)?$/) };
}

// ---------------------------------------------------------------------------------------
// Sign convention and meaning

const TRANSFER = /transfer|credit card payment|^payment$|balance adjustment|^loan payment/i;
const INCOME = /paycheck|payroll|salary|wages|direct dep|^income$/i;
/** Trades, reinvested dividends and rows the user hid in their old app say nothing about spending. */
const IGNORE = /^(buy|sell|dividends? & capital gains|hide from budgets & trends|investments?)$/i;
const REINVEST = /\breinvest/i;
/** Retirement, brokerage and health-savings accounts never hold spendable cash. */
const INVESTMENT_ACCOUNT = /\b(ira|roth|401\(?k\)?|403\(?b\)?|hsa|health savings|brokerage|savings plan|self-directed|retirement)\b/i;

/**
 * Some exports (Copilot, most bank files) don't say which way their sign points. Income rows
 * decide it when there are any; otherwise we assume most rows are spending and say we guessed.
 */
function resolvePolarity(raws: Raw[]): { polarity: 1 | -1; guessed: boolean } {
  const unknown = raws.filter((r) => r.polarity === 0 && r.value !== 0);
  if (!unknown.length) return { polarity: 1, guessed: false };
  const income = unknown.filter((r) => r.incomeHint || INCOME.test(r.category ?? "") || INCOME.test(r.name));
  if (income.length) {
    const negative = income.filter((r) => r.value < 0).length;
    return { polarity: negative >= income.length / 2 ? 1 : -1, guessed: false };
  }
  const positive = unknown.filter((r) => r.value > 0).length;
  return { polarity: positive >= unknown.length / 2 ? 1 : -1, guessed: true };
}

function classify(r: Raw, amount: number): Kind {
  if (r.excluded || IGNORE.test(r.category ?? "") || REINVEST.test(`${r.name} ${r.description ?? ""}`) || INVESTMENT_ACCOUNT.test(r.accountLabel ?? "")) return "ignored";
  if (r.transferHint || TRANSFER.test(r.category ?? "")) return "transfer";
  if (amount < 0 && (r.incomeHint || INCOME.test(r.category ?? "") || INCOME.test(r.name) || INCOME.test(r.description ?? ""))) return "income";
  return "spend";
}

// ---------------------------------------------------------------------------------------
// Field parsing

export function parseDate(s: string | undefined): string {
  const v = (s ?? "").trim();
  let m = v.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return iso(y, +m[1], +m[2]);
  }
  throw new Error(`Unreadable date "${v}"`);
}

export function parseAmount(s: string | undefined): number {
  let v = (s ?? "").trim().replace(/[\s$,€£]/g, "").replace(/−/g, "-");
  let sign = 1;
  if (/^\(.*\)$/.test(v)) {
    sign = -1;
    v = v.slice(1, -1);
  }
  if (v.endsWith("-")) {
    sign = -sign;
    v = v.slice(0, -1);
  }
  const n = Number(v);
  if (v === "" || !Number.isFinite(n)) throw new Error(`Unreadable amount "${s}"`);
  return sign * n;
}

function iso(y: number, m: number, d: number): string {
  if (m < 1 || m > 12 || d < 1 || d > 31) throw new Error(`Unreadable date "${y}-${m}-${d}"`);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Monarch writes accounts like "Everyday Checking (...4417)", and sometimes
 * "Card (...XXXX-XXXX-XXXX-1234)". The mask is the last four digits inside the brackets.
 */
function splitAccount(label: string | undefined): { accountLabel?: string; accountMask?: string } {
  const v = (label ?? "").trim();
  const m = v.match(/^(.*?)\s*\(([^()]*\d[^()]*)\)\s*$/);
  const mask = m?.[2].replace(/\D/g, "").slice(-4);
  return m && mask && mask.length >= 2 ? { accountLabel: m[1], accountMask: mask } : { accountLabel: v || undefined };
}

function digits(s: string | undefined): string | undefined {
  const d = (s ?? "").replace(/\D/g, "");
  return d || undefined;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** cyrb53: a fast, stable 53-bit string hash that runs the same in the browser and on the edge. */
function hash(s: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
