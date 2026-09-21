import { describe, expect, it } from "vitest";
import {
  createAttributeDefinitionSchema,
  templateSchema,
  validateAttributeValue,
  type AttributeDataType,
  type ResolvedAttributeField,
} from "@clothing-brand/shared";
import { buildSizeGuideView, buildSpecGroups, fromStoredRow, presentAttributes, toStoredColumns } from "./catalog.presenter";

function field(key: string, dataType: AttributeDataType, over: Partial<ResolvedAttributeField> = {}): ResolvedAttributeField {
  return {
    definitionId: `d_${key}`, key, label: key.toUpperCase(), dataType, unit: null, placeholder: null, helpText: null,
    required: false, options: [], specGroupId: null, specGroupName: null, showOnStorefront: true, ...over,
  };
}

describe("validateAttributeValue", () => {
  const check = (dataType: AttributeDataType, value: unknown, options: string[] = []) =>
    validateAttributeValue({ label: "F", dataType, options }, value);

  it("treats blank values as fine — required-ness is a separate rule", () => {
    for (const blank of ["", "  ", null, undefined, []]) expect(check("TEXT", blank)).toBeNull();
  });

  it("checks numbers, accepting numeric strings from form inputs", () => {
    expect(check("NUMBER", 42)).toBeNull();
    expect(check("MEASUREMENT", "12.5")).toBeNull();
    expect(check("NUMBER", "abc")).not.toBeNull();
    expect(check("NUMBER", Infinity)).not.toBeNull();
  });

  it("only accepts http(s) links", () => {
    expect(check("URL", "https://example.com/a?b=1")).toBeNull();
    expect(check("URL", "javascript:alert(1)")).not.toBeNull();
    expect(check("URL", "not a url")).not.toBeNull();
  });

  it("checks booleans and dates", () => {
    expect(check("BOOLEAN", false)).toBeNull();
    expect(check("BOOLEAN", "yes")).not.toBeNull();
    expect(check("DATE", "2026-09-21")).toBeNull();
    expect(check("DATE", "21/09/2026")).not.toBeNull();
  });

  it("holds select values to the option list", () => {
    expect(check("SELECT", "Slim", ["Regular", "Slim"])).toBeNull();
    expect(check("SELECT", "Baggy", ["Regular", "Slim"])).not.toBeNull();
    expect(check("MULTI_SELECT", ["A", "B"], ["A", "B", "C"])).toBeNull();
    expect(check("MULTI_SELECT", ["A", "Z"], ["A", "B", "C"])).not.toBeNull();
  });

  it("caps text length", () => {
    expect(check("TEXT", "x".repeat(501))).not.toBeNull();
    expect(check("TEXTAREA", "x".repeat(501))).toBeNull();
  });
});

describe("attribute value storage", () => {
  it("round-trips every data type through its typed column", () => {
    const cases: [AttributeDataType, unknown, unknown][] = [
      ["TEXT", "  hello ", "hello"],
      ["NUMBER", "12.5", 12.5],
      ["MEASUREMENT", 3, 3],
      ["BOOLEAN", false, false],
      ["DATE", "2026-09-21", "2026-09-21"],
      ["MULTI_SELECT", ["A", "B"], ["A", "B"]],
      ["SELECT", "Slim", "Slim"],
    ];
    for (const [type, input, expected] of cases) {
      const cols = toStoredColumns(type, input);
      expect(fromStoredRow(type, cols)).toEqual(expected);
      // Exactly one typed column is populated.
      expect(Object.values(cols).filter((v) => v !== null)).toHaveLength(1);
    }
  });
});

describe("presentAttributes", () => {
  const fields = [field("material", "TEXT"), field("fit", "SELECT", { options: ["Slim"] })];
  const row = (key: string, dataType: string, valueText: string) => ({
    definition: { key, dataType }, valueText, valueNumber: null, valueBoolean: null, valueDate: null, valueJson: null,
  });

  it("prefers typed rows over legacy JSON for defined fields", () => {
    const out = presentAttributes({ attributes: { material: "stale" }, attributeValues: [row("material", "TEXT", "Linen")] }, fields);
    expect(out.material).toBe("Linen");
  });

  it("falls back to legacy JSON for a defined field with no row yet", () => {
    expect(presentAttributes({ attributes: { material: "Cotton" }, attributeValues: [] }, fields).material).toBe("Cotton");
  });

  it("keeps legacy keys that have no definition, and hides orphaned rows of other types", () => {
    const out = presentAttributes(
      { attributes: { sizeGuide: { enabled: true } }, attributeValues: [row("embroidery", "TEXT", "Hand")] },
      fields,
    );
    expect(out).toEqual({ sizeGuide: { enabled: true } });
  });
});

describe("buildSpecGroups", () => {
  it("groups by spec group in first-appearance order, skipping blanks and storefront-hidden fields", () => {
    const fields = [
      field("a", "TEXT", { specGroupName: "Details" }),
      field("b", "TEXT", { specGroupName: "Notes" }),
      field("c", "TEXT", { specGroupName: "Details" }),
      field("d", "TEXT", { specGroupName: "Details", showOnStorefront: false }),
      field("e", "TEXT"),
    ];
    const groups = buildSpecGroups(fields, { a: "1", b: "2", c: "3", d: "hidden", e: "5" });
    expect(groups.map((g) => g.name)).toEqual(["Details", "Notes", "Specifications"]);
    expect(groups[0]!.items.map((i) => i.key)).toEqual(["a", "c"]);
    expect(buildSpecGroups(fields, { a: "" })).toEqual([]);
  });

  it("shows an explicit false (a real 'No') but not an empty multi-select", () => {
    const groups = buildSpecGroups([field("adj", "BOOLEAN"), field("tags", "MULTI_SELECT")], { adj: false, tags: [] });
    expect(groups[0]!.items.map((i) => i.key)).toEqual(["adj"]);
  });
});

describe("buildSizeGuideView", () => {
  const chart = { title: "Preset", columns: ["Size"], rows: [["M"]] };
  const cfg = (mode: "NOT_APPLICABLE" | "OFF_BY_DEFAULT" | "ON_BY_DEFAULT") => ({ sizeGuide: { mode, presetId: "p", chart } });

  it("never shows a guide for a type that doesn't have one, whatever is stored", () => {
    expect(buildSizeGuideView(cfg("NOT_APPLICABLE"), { sizeGuide: { enabled: true, columns: [], rows: [] } })).toEqual({ show: false, chart: null });
  });

  it("starts from the preset, on or off by mode", () => {
    expect(buildSizeGuideView(cfg("ON_BY_DEFAULT"), {})).toEqual({ show: true, chart });
    expect(buildSizeGuideView(cfg("OFF_BY_DEFAULT"), {}).show).toBe(false);
  });

  it("lets the product's own saved guide win, including switching it off", () => {
    const own = { enabled: false, columns: ["X"], rows: [["1"]] };
    expect(buildSizeGuideView(cfg("ON_BY_DEFAULT"), { sizeGuide: own })).toEqual({ show: false, chart: own });
  });
});

describe("admin input schemas", () => {
  it("requires options for select attributes and rejects reserved keys", () => {
    expect(createAttributeDefinitionSchema.safeParse({ key: "fitType", label: "Fit", dataType: "SELECT" }).success).toBe(false);
    expect(createAttributeDefinitionSchema.safeParse({ key: "fitType", label: "Fit", dataType: "SELECT", options: ["A"] }).success).toBe(true);
    expect(createAttributeDefinitionSchema.safeParse({ key: "constructor", label: "X", dataType: "TEXT" }).success).toBe(false);
  });

  it("rejects duplicate options (case-insensitively)", () => {
    expect(createAttributeDefinitionSchema.safeParse({ key: "fitType", label: "Fit", dataType: "SELECT", options: ["Slim", "slim"] }).success).toBe(false);
  });

  it("limits a template to one size and one colour dimension", () => {
    const dim = (targetField: "size" | "color") => ({ targetField, label: "L", options: [] });
    expect(templateSchema.safeParse({ name: "T", variantDimensions: [dim("size"), dim("color")] }).success).toBe(true);
    expect(templateSchema.safeParse({ name: "T", variantDimensions: [dim("size"), dim("size")] }).success).toBe(false);
  });
});
