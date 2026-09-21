import { describe, it, expect } from "vitest";
import {
  formatAttributeCell,
  formatBoolean,
  formatMaterialsCell,
  parseAttributeCell,
  parseBoolean,
  parseDecimal,
  parseInteger,
  parseMaterialsCell,
  type MaterialRef,
} from "./product-csv-format";

const value = <T>(r: { ok: boolean; value?: T; message?: string }) => (r.ok ? r.value : `ERR: ${r.message}`);

describe("numbers and booleans", () => {
  it("parses plain decimals and refuses anything ambiguous", () => {
    expect(value(parseDecimal("1250"))).toBe(1250);
    expect(value(parseDecimal(" 12.50 "))).toBe(12.5);
    for (const badText of ["1,200", "1.200,50", "12abc", "", "৳500", "1e3", ".5"]) expect(parseDecimal(badText).ok).toBe(false);
    expect(parseDecimal("-1", { min: 0 }).ok).toBe(false);
    expect(parseDecimal("101", { max: 100 }).ok).toBe(false);
  });

  it("parses whole numbers", () => {
    expect(value(parseInteger("7"))).toBe(7);
    expect(parseInteger("7.5").ok).toBe(false);
    expect(parseInteger("-3", { min: 0 }).ok).toBe(false);
  });

  it("accepts the usual yes/no spellings", () => {
    for (const t of ["yes", "YES", "Y", "true", "1"]) expect(value(parseBoolean(t))).toBe(true);
    for (const t of ["no", "N", "False", "0"]) expect(value(parseBoolean(t))).toBe(false);
    expect(parseBoolean("maybe").ok).toBe(false);
    expect(formatBoolean(true)).toBe("yes");
  });
});

describe("attribute cells", () => {
  const field = (dataType: never, options: string[] = []) => ({ label: "Field", dataType, options });

  it("matches select options case-insensitively and returns the canonical spelling", () => {
    expect(value(parseAttributeCell(field("SELECT" as never, ["Cotton", "Silk"]), "silk"))).toBe("Silk");
    expect(parseAttributeCell(field("SELECT" as never, ["Cotton", "Silk"]), "Wool").ok).toBe(false);
  });

  it("splits multi-selects on | and rejects unknown options", () => {
    expect(value(parseAttributeCell(field("MULTI_SELECT" as never, ["A", "B", "C"]), "a | C | a"))).toEqual(["A", "C"]);
    expect(parseAttributeCell(field("MULTI_SELECT" as never, ["A", "B"]), "A|Z").ok).toBe(false);
  });

  it("types numbers, booleans and dates, and validates links", () => {
    expect(value(parseAttributeCell(field("NUMBER" as never), "42.5"))).toBe(42.5);
    expect(parseAttributeCell(field("NUMBER" as never), "lots").ok).toBe(false);
    expect(value(parseAttributeCell(field("BOOLEAN" as never), "yes"))).toBe(true);
    expect(value(parseAttributeCell(field("DATE" as never), "2026-09-22"))).toBe("2026-09-22");
    expect(parseAttributeCell(field("DATE" as never), "22/09/2026").ok).toBe(false);
    expect(parseAttributeCell(field("DATE" as never), "2026-13-45").ok).toBe(false);
    expect(parseAttributeCell(field("URL" as never), "not a link").ok).toBe(false);
    expect(value(parseAttributeCell(field("URL" as never), "https://example.com/a"))).toBe("https://example.com/a");
  });

  it("enforces the shared length limits", () => {
    expect(parseAttributeCell(field("TEXT" as never), "x".repeat(501)).ok).toBe(false);
  });

  it("formats values so that parsing them gives the same value back", () => {
    expect(formatAttributeCell("BOOLEAN", true)).toBe("yes");
    expect(formatAttributeCell("MULTI_SELECT", ["A", "B"])).toBe("A|B");
    expect(formatAttributeCell("DATE", new Date("2026-09-22T00:00:00Z"))).toBe("2026-09-22");
    expect(formatAttributeCell("NUMBER", 4.5)).toBe("4.5");
    expect(formatAttributeCell("TEXT", null)).toBe("");
    const roundTrip = (t: never, opts: string[], v: unknown) => value(parseAttributeCell(field(t, opts), formatAttributeCell(t, v)));
    expect(roundTrip("MULTI_SELECT" as never, ["A", "B"], ["A", "B"])).toEqual(["A", "B"]);
    expect(roundTrip("BOOLEAN" as never, [], false)).toBe(false);
    expect(roundTrip("NUMBER" as never, [], 12.25)).toBe(12.25);
  });
});

describe("materials", () => {
  const catalog = new Map<string, MaterialRef>([
    ["cotton", { id: "m1", name: "Cotton", isArchived: false }],
    ["polyester", { id: "m2", name: "Polyester", isArchived: false }],
    ["linen", { id: "m3", name: "Linen", isArchived: true }],
  ]);

  it("resolves catalog names case-insensitively, with or without percentages", () => {
    const r = parseMaterialsCell("cotton:80|Polyester: 20%", catalog);
    expect(r.error).toBeNull();
    expect(r.lines).toEqual([{ materialId: "m1", percentage: 80 }, { materialId: "m2", percentage: 20 }]);
    expect(parseMaterialsCell("Cotton", catalog).lines).toEqual([{ materialId: "m1", percentage: null }]);
  });

  it("keeps unknown or archived materials as plain text and says so", () => {
    const r = parseMaterialsCell("Bamboo:50|Linen:50", catalog);
    expect(r.lines).toEqual([{ customName: "Bamboo", percentage: 50 }, { customName: "Linen", percentage: 50 }]);
    expect(r.warnings).toHaveLength(2);
    expect(r.warnings[1]).toMatch(/archived/);
  });

  it("refuses more than 100% and bad percentages", () => {
    expect(parseMaterialsCell("Cotton:70|Polyester:40", catalog).error).toMatch(/more than 100%/);
    expect(parseMaterialsCell("Cotton:0", catalog).error).toBeTruthy();
    expect(parseMaterialsCell(":50", catalog).error).toMatch(/no material name/);
  });

  it("formats and re-parses", () => {
    const text = formatMaterialsCell([{ name: "Cotton", percentage: 80 }, { name: "Polyester", percentage: null }]);
    expect(text).toBe("Cotton:80|Polyester");
    expect(parseMaterialsCell(text, catalog).lines).toEqual([{ materialId: "m1", percentage: 80 }, { materialId: "m2", percentage: null }]);
  });
});
