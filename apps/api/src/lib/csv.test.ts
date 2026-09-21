import { describe, it, expect } from "vitest";
import { csvCell, CsvParseError, parseCsv, toCsv, unguardCell } from "./csv";

const cells = (text: string) => parseCsv(text).map((r) => r.cells);

describe("parseCsv", () => {
  it("reads plain rows with LF, CRLF and a missing final newline", () => {
    expect(cells("a,b\n1,2\r\n3,4")).toEqual([["a", "b"], ["1", "2"], ["3", "4"]]);
  });

  it("handles quotes, doubled quotes, embedded commas and embedded newlines", () => {
    const rows = parseCsv('name,notes\n"Panjabi, black","He said ""hi""\nsecond line"\nplain,x');
    expect(rows.map((r) => r.cells)).toEqual([["name", "notes"], ["Panjabi, black", 'He said "hi"\nsecond line'], ["plain", "x"]]);
    // The line numbers are what a spreadsheet shows: the record after a two-line quoted cell starts on line 4.
    expect(rows.map((r) => r.line)).toEqual([1, 2, 4]);
  });

  it("ignores a byte-order mark and blank lines, and keeps empty cells", () => {
    expect(cells("\ufeffa,b,c\n\n1,,3\n,,\n")).toEqual([["a", "b", "c"], ["1", "", "3"]]);
  });

  it("detects a semicolon-separated file from its header", () => {
    expect(cells("a;b\n1;2")).toEqual([["a", "b"], ["1", "2"]]);
    expect(cells("a,b;c\n1,2;3")).toEqual([["a", "b;c"], ["1", "2;3"]]); // a comma header wins
  });

  it("does not treat a quote in the middle of a value as the start of a quoted value", () => {
    expect(cells('5" nail,ok')).toEqual([['5" nail', "ok"]]);
  });

  it("refuses an unterminated quote, naming the line it began on", () => {
    expect(() => parseCsv('a,b\n1,"never closed\n2,3')).toThrow(CsvParseError);
    try {
      parseCsv('a,b\n1,"never closed');
    } catch (err) {
      expect((err as CsvParseError).line).toBe(2);
    }
  });
});

describe("csvCell / toCsv", () => {
  it("quotes only when needed", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "x"')).toBe('"say ""x"""');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(12.5)).toBe("12.5");
    expect(csvCell(false)).toBe("false");
  });

  it("defuses spreadsheet formulas in text, but leaves numbers alone", () => {
    for (const evil of ["=HYPERLINK(\"http://x\")", "+1+1", "-2+3", "@SUM(A1)", "\tcmd", "\rcmd"]) {
      expect(csvCell(evil).replace(/^"/, "").startsWith("'")).toBe(true);
    }
    expect(csvCell(-5)).toBe("-5"); // a negative *number* is not a formula
    // …nor is a phone number or a number written as text, which a guard would corrupt.
    for (const plain of ["+8801711223344", "-5", "+1 (555) 123-4567", "-12.50"]) expect(csvCell(plain)).toBe(plain);
    for (const evil of ["+cmd|' /C calc'!A0", "-1+cmd", "=1+1", "@A1", "+SUM(1)"]) expect(csvCell(evil).replace(/^"/, "").startsWith("'")).toBe(true);
    expect(csvCell("normal = fine")).toBe("normal = fine"); // only a leading character matters
  });

  it("round-trips through parse and unguard, whatever the content", () => {
    const values = ["=1+1", "a,b", 'q"uote', "line\nbreak", "-dash", "@at", "  spaced  ", "ok", ""];
    const parsed = parseCsv(toCsv(["v"], values.map((v) => [v])));
    expect(parsed.slice(1).map((r) => unguardCell(r.cells[0]!))).toEqual(values.filter((v) => v !== "")); // a fully empty line is skipped
  });
});

describe("unguardCell", () => {
  it("only removes the guard it added", () => {
    expect(unguardCell("'=SUM(1)")).toBe("=SUM(1)");
    expect(unguardCell("'quoted word")).toBe("'quoted word");
    expect(unguardCell("plain")).toBe("plain");
  });
});
