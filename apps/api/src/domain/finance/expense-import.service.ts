/**
 * Expenses from a file (docs/FINANCE_EXPENSES.md §6): the owner's history — SMS recharges, rent, salaries, packaging bought,
 * ad top-ups — typed into a sheet and brought in at once, each row exactly as an expense typed by hand would be: its
 * category (an expense account of the chart), the money account it was paid from, or the owner's own pocket (owed back
 * to them, or added as their capital), payee and reference.
 *
 * Nothing is guessed: a row whose category or money account isn't recognised, whose date is before the books or in the
 * future, or whose amount isn't a positive number is shown with its problem and left out; a row that looks already
 * recorded (same category, date and amount — and payee when given) is shown as a likely duplicate and left out unless the
 * owner includes it. The preview writes nothing. Committing posts each row through recordExpense / ownerPaidExpense with
 * a key made from the file and the row, so the same file sent again records nothing twice.
 */
import { createHash } from "node:crypto";
import { prisma } from "../../config/prisma";
import type { FinanceActor } from "./finance-audit";
import { businessToday, getFinanceContext } from "./finance-context";
import { financeError, toMinor } from "./finance-values";
import { recordExpense } from "./expenses.service";
import { ownerPaidExpense } from "./custody.service";

export interface ImportRow {
  line: number;
  date: string | null;
  category: { id: string; code: string; name: string } | null;
  amount: number | null;
  paidFrom: { kind: "ACCOUNT"; id: string; name: string } | { kind: "OWNER"; funding: "REIMBURSE" | "CAPITAL"; cashAccountId: string } | null;
  payee: string | null;
  description: string;
  reference: string | null;
  status: "OK" | "DUPLICATE" | "PROBLEM";
  problem: string | null;
}

/** Minimal RFC-4180 reader: commas or semicolons/tabs as separators, double quotes with "" escapes, CRLF or LF. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const sep = firstLine.includes("\t") ? "\t" : !firstLine.includes(",") && firstLine.includes(";") ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === sep) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

const HEADERS: Record<string, string[]> = {
  date: ["date", "তারিখ", "expense date"],
  category: ["category", "ক্যাটাগরি", "account", "খাত", "type"],
  amount: ["amount", "টাকা", "পরিমাণ", "taka"],
  paidFrom: ["paid from", "paid_from", "from", "কোথা থেকে", "source", "paid by"],
  payee: ["payee", "paid to", "কাকে", "to", "vendor"],
  description: ["description", "বিবরণ", "details", "what", "note"],
  reference: ["reference", "ref", "রেফারেন্স", "trx", "trx id", "transaction id"],
};
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** "2026-10-05", "05/10/2026" or "5-10-2026" (day first) → YYYY-MM-DD; null when not a date. */
export function parseDate(s: string): string | null {
  const t = s.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m) return valid(+m[1]!, +m[2]!, +m[3]!);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t);
  if (m) return valid(+m[3]!, +m[2]!, +m[1]!);
  return null;
}
function valid(y: number, mo: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}
/** "1,250.50", "1250 tk", with or without the taka sign → 1250.5; Bengali digits read too. null when not a positive amount with ≤ 2 decimals. */
export function parseAmount(s: string): number | null {
  const ascii = s.replace(/[০-৯]/g, (d) => String("০১২৩৪৫৬৭৮৯".indexOf(d))).replace(/[\u09F3,\s]|tk|taka|bdt/gi, "");
  if (!/^\d+(\.\d{1,2})?$/.test(ascii)) return null;
  const n = Number(ascii);
  return n > 0 ? n : null;
}

const OWNER_REIMBURSE = ["owner", "owner pocket", "owner (pay back)", "মালিক", "মালিকের পকেট", "নিজের পকেট"];
const OWNER_CAPITAL = ["owner capital", "capital", "পুঁজি", "মালিকের পুঁজি"];

export async function previewExpenseImport(csv: string) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const rows = parseCsv(csv);
  if (rows.length < 2) throw financeError(400, "IMPORT_EMPTY", "The file needs a header row and at least one expense");
  const header = rows[0]!.map(norm);
  const col = (k: keyof typeof HEADERS) => header.findIndex((h) => HEADERS[k]!.includes(h));
  const at = { date: col("date"), category: col("category"), amount: col("amount"), paidFrom: col("paidFrom"), payee: col("payee"), description: col("description"), reference: col("reference") };
  const missing = (["date", "category", "amount", "paidFrom"] as const).filter((k) => at[k] < 0);
  if (missing.length) throw financeError(400, "IMPORT_COLUMNS", `The header row needs: ${missing.join(", ")} (date, category, amount, paid from — payee, description and reference are optional)`);

  const [accounts, money, opening] = await Promise.all([
    prisma.ledgerAccount.findMany({ where: { businessId: business.id, isActive: true, isPostable: true, type: { in: ["EXPENSE", "OTHER_EXPENSE"] } }, select: { id: true, code: true, name: true } }),
    prisma.financialAccount.findMany({ where: { businessId: business.id, isActive: true, kind: { in: ["CASH", "BANK", "MOBILE_WALLET"] } }, select: { id: true, name: true, kind: true } }),
    prisma.financeBusiness.findUniqueOrThrow({ where: { id: business.id }, select: { openingDate: true } }),
  ]);
  const openingDate = opening.openingDate ? opening.openingDate.toISOString().slice(0, 10) : null;
  const today = businessToday(business);
  const cash = money.find((m) => m.kind === "CASH") ?? null;
  const out: ImportRow[] = [];
  for (const [i, r] of rows.slice(1).entries()) {
    const get = (k: keyof typeof at) => (at[k] >= 0 ? (r[at[k]] ?? "").trim() : "");
    const problems: string[] = [];
    const date = parseDate(get("date"));
    if (!date) problems.push(`date "${get("date")}" isn't a date (use 2026-10-05 or 05/10/2026)`);
    else if (openingDate && date < openingDate) problems.push(`before the books start (${openingDate})`);
    else if (date > today) problems.push("in the future");
    const catText = norm(get("category"));
    const category = accounts.find((a) => a.code === catText || norm(a.name) === catText) ?? null;
    if (!category) problems.push(`no expense category "${get("category")}" — add it first (Finance › Expenses › New category), then send the file again`);
    const amount = parseAmount(get("amount"));
    if (amount === null) problems.push(`amount "${get("amount")}" isn't a positive amount`);
    const fromText = norm(get("paidFrom"));
    let paidFrom: ImportRow["paidFrom"] = null;
    if (OWNER_CAPITAL.includes(fromText) || OWNER_REIMBURSE.includes(fromText)) {
      if (!cash) problems.push("an owner-paid expense goes through a cash account — add one first");
      else paidFrom = { kind: "OWNER", funding: OWNER_CAPITAL.includes(fromText) ? "CAPITAL" : "REIMBURSE", cashAccountId: cash.id };
    } else {
      const m = money.find((x) => norm(x.name) === fromText);
      if (m) paidFrom = { kind: "ACCOUNT", id: m.id, name: m.name };
      else problems.push(money.length ? `paid from "${get("paidFrom")}" isn't a money account (${money.map((x) => x.name).join(", ")}) or "owner" / "owner capital"` : `paid from "${get("paidFrom")}": no cash, bank or wallet account yet — add one under Finance › Money, or write "owner"`);
    }
    out.push({
      line: i + 2, date, category, amount, paidFrom,
      payee: get("payee") || null,
      description: get("description") || (category ? category.name : "Expense"),
      reference: get("reference") || null,
      status: problems.length ? "PROBLEM" : "OK",
      problem: problems.length ? problems.join("; ") : null,
    });
  }
  // likely already recorded: same category, date and amount (and payee when the row names one)
  const ok = out.filter((r) => r.status === "OK");
  if (ok.length) {
    const existing = await prisma.expense.findMany({
      where: { businessId: business.id, expenseAccountId: { in: [...new Set(ok.map((r) => r.category!.id))] }, expenseDate: { in: [...new Set(ok.map((r) => new Date(`${r.date}T00:00:00Z`)))] }, movement: { status: { in: ["POSTED", "PENDING_APPROVAL"] } } },
      select: { expenseAccountId: true, expenseDate: true, amount: true, payee: true },
    });
    for (const r of ok) {
      const hit = existing.some((e) => e.expenseAccountId === r.category!.id && e.expenseDate.toISOString().slice(0, 10) === r.date && toMinor(e.amount, cur) === toMinor(r.amount!, cur) && (!r.payee || norm(e.payee ?? "") === norm(r.payee)));
      if (hit) { r.status = "DUPLICATE"; r.problem = "looks already recorded (same category, date and amount)"; }
    }
  }
  const fileKey = createHash("sha256").update(csv.replace(/\r\n/g, "\n").trim()).digest("hex").slice(0, 32);
  return {
    fileKey,
    rows: out,
    totals: {
      ok: out.filter((r) => r.status === "OK").length,
      duplicates: out.filter((r) => r.status === "DUPLICATE").length,
      problems: out.filter((r) => r.status === "PROBLEM").length,
      amount: Math.round(out.filter((r) => r.status === "OK").reduce((s, r) => s + (r.amount ?? 0), 0) * 100) / 100,
    },
  };
}

/** Records the file's good rows (and the likely duplicates when the owner includes them). Same file again → no new rows. */
export async function commitExpenseImport(input: { csv: string; includeDuplicates?: boolean }, actor: FinanceActor) {
  const preview = await previewExpenseImport(input.csv);
  const take = preview.rows.filter((r) => r.status === "OK" || (input.includeDuplicates && r.status === "DUPLICATE"));
  const results: Array<{ line: number; status: "RECORDED" | "FAILED"; number?: string; state?: string; problem?: string }> = [];
  for (const r of take) {
    const key = `expense-import:${preview.fileKey}:${r.line}`;
    try {
      if (r.paidFrom!.kind === "OWNER") {
        const res = await ownerPaidExpense({ cashFinancialAccountId: r.paidFrom!.cashAccountId, expenseAccountId: r.category!.id, amount: r.amount!, expenseDate: r.date!, description: r.description, payee: r.payee, reference: r.reference, funding: r.paidFrom!.funding }, actor, key);
        results.push({ line: r.line, status: "RECORDED", number: (res as { expense?: { number?: string } }).expense?.number, state: "POSTED" });
      } else {
        const e = await recordExpense({ expenseAccountId: r.category!.id, amount: r.amount!, expenseDate: r.date!, costBehaviour: "VARIABLE", payee: r.payee, description: r.description, reference: r.reference, fromFinancialAccountId: r.paidFrom!.id }, actor, key);
        results.push({ line: r.line, status: "RECORDED", number: (e as { number?: string }).number, state: (e as { status?: string }).status });
      }
    } catch (err) {
      results.push({ line: r.line, status: "FAILED", problem: err instanceof Error ? err.message : String(err) });
    }
  }
  return { fileKey: preview.fileKey, recorded: results.filter((x) => x.status === "RECORDED").length, failed: results.filter((x) => x.status === "FAILED").length, results, skipped: preview.rows.length - take.length };
}
