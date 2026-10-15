import { describe, expect, it } from "vitest";
import { expandSizeFilter, groupSizeFacets } from "./size-facets";

describe("size facets", () => {
  it("merges spellings of the same size into one chip, labelled by the most-used spelling", () => {
    const groups = groupSizeFacets([
      { size: "2XL 23.5", count: 1 },
      { size: "2XL/23.5", count: 4 },
      { size: "M 22", count: 1 },
      { size: "M/22", count: 5 },
    ]);
    expect(groups.map((g) => g.label)).toEqual(["M/22", "2XL/23.5"]);
  });

  it("orders letter sizes small to large, then numbers, then anything else", () => {
    const groups = groupSizeFacets(["XL/23", "S/21.5", "2XL/23.5", "XS/21", "M/22", "L/22.5", "42", "38", "Free size", "XXS"].map((size) => ({ size, count: 1 })));
    expect(groups.map((g) => g.label)).toEqual(["XXS", "XS/21", "S/21.5", "M/22", "L/22.5", "XL/23", "2XL/23.5", "38", "42", "Free size"]);
  });

  it("treats XXL and 2XL as the same rank but keeps them apart when spelled differently", () => {
    const groups = groupSizeFacets([{ size: "XXL", count: 1 }, { size: "XL", count: 1 }, { size: "3XL", count: 1 }]);
    expect(groups.map((g) => g.label)).toEqual(["XL", "XXL", "3XL"]);
  });

  it("expands a chosen chip to every stored spelling of it", () => {
    const stored = ["2XL 23.5", "2XL/23.5", "M/22", "M 22", "L/22.5"];
    expect(expandSizeFilter(["2XL/23.5"], stored).sort()).toEqual(["2XL 23.5", "2XL/23.5"]);
    expect(expandSizeFilter(["m 22"], stored).sort()).toEqual(["M 22", "M/22"]);
  });

  it("keeps an unknown chosen size as is, so the filter simply matches nothing", () => {
    expect(expandSizeFilter(["XS/21"], ["M/22"])).toEqual(["XS/21"]);
  });
});
