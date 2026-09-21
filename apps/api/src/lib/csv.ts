/** A small, dependency-free CSV reader/writer (RFC 4180: quoted fields, doubled quotes, embedded commas and newlines, CRLF or LF).
 *
 * The writer also defuses spreadsheet formula injection: Excel and Sheets run a cell that starts with = + - @ (or a tab / CR) as a
 * formula, so an exported product named `=HYPERLINK(...)` would execute on whoever opens the file. Such text cells are prefixed
 * with an apostrophe, which spreadsheets hide; `unguardCell` removes it again when a file is read back, so an export imports
 * to exactly what it exported. Numbers are never touched (a negative number is not a formula). */

const FORMULA_START = /^[=+\-@\t\r]/;
/** A phone number, or a number written as text ("+8801711223344", "-5", "+1 (555) 123-4567"), starts with + or - but can't run
 * anything: no letters, no cell references, no function calls. Guarding it would corrupt real data in an export. */
const PLAIN_NUMBER = /^[+-]?\d[\d\s().-]*$/;

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let str = typeof value === "string" ? value : String(value);
  if (typeof value === "string" && FORMULA_START.test(str) && !PLAIN_NUMBER.test(str)) str = `'${str}`;
  return /[",\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** Undoes csvCell's guard: `'=SUM(A1)` was written for `=SUM(A1)`. */
export function unguardCell(value: string): string {
  return /^'[=+\-@\t\r]/.test(value) ? value.slice(1) : value;
}

export class CsvParseError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(message);
  }
}

export interface CsvRecord {
  /** The line the record starts on (the first line of the file is 1) — what a person sees in their spreadsheet. */
  line: number;
  cells: string[];
}

/** Parses CSV text into records. Skips a byte-order mark and fully blank lines. A file that uses `;` instead of `,`
 * (Excel in many locales) is detected from its first line. Throws CsvParseError on an unterminated quote. */
export function parseCsv(input: string): CsvRecord[] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const firstLine = text.split(/\r\n|\n|\r/, 1)[0] ?? "";
  const delimiter = !firstLine.includes(",") && firstLine.includes(";") ? ";" : ",";

  const records: CsvRecord[] = [];
  let cells: string[] = [];
  let field = "";
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;
  let fieldWasQuoted = false;

  const endField = () => {
    cells.push(field);
    field = "";
    fieldWasQuoted = false;
  };
  const endRecord = () => {
    endField();
    // A line with nothing on it (or only delimiters) isn't a record.
    if (cells.some((c) => c.trim() !== "")) records.push({ line: recordLine, cells });
    cells = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === "\n") line++;
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field === "" && !fieldWasQuoted) {
      inQuotes = true;
      fieldWasQuoted = true;
    } else if (ch === delimiter) {
      endField();
    } else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      endRecord();
      line++;
      recordLine = line;
    } else {
      field += ch;
    }
  }
  if (inQuotes) throw new CsvParseError("A quoted value is never closed", recordLine);
  if (field !== "" || cells.length > 0) endRecord();
  return records;
}
