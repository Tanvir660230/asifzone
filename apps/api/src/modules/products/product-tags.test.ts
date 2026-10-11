import { describe, expect, it } from "vitest";
import { createSearchExpander, expandSearchTerms, normalizeProductTag, searchSynonymSchema, updateProductSchema } from "@clothing-brand/shared";

describe("product search tags", () => {
  it("normalizes a tag the way search normalizes a query", () => {
    expect(normalizeProductTag("  #Ator ")).toBe("ator");
    expect(normalizeProductTag("# Black   Attar")).toBe("black attar");
    expect(normalizeProductTag("টুপী")).toBe("টুপি");
  });

  it("drops blanks and duplicates after normalization", () => {
    const parsed = updateProductSchema.parse({ tags: ["Ator", "ator", " ", "#ATOR", "আতর"] });
    expect(parsed.tags).toEqual(["ator", "আতর"]);
  });

  it("a stored tag is one of the terms a shopper's search expands to", () => {
    const cases: [string, string][] = [["ator", "Ator"], ["ator", "ator perfume"], ["black attar", "Black Attar"], ["টুপি", "টুপী"]];
    for (const [tag, query] of cases) expect(expandSearchTerms(query)).toContain(normalizeProductTag(tag));
  });
});

describe("store synonym groups", () => {
  it("built-in dictionary knows the common attar spellings", () => {
    expect(expandSearchTerms("ator")).toEqual(expect.arrayContaining(["attar", "আতর"]));
  });

  it("an admin group links words the built-in dictionary keeps apart", () => {
    expect(expandSearchTerms("attar")).not.toContain("perfume");
    const expander = createSearchExpander([["attar", "perfume"]]);
    expect(expander.expand("attar")).toContain("perfume");
    expect(expander.expand("perfume")).toContain("attar");
    // The group covers every built-in spelling of its words, both ways.
    expect(expander.expand("ator")).toEqual(expect.arrayContaining(["perfume", "fragrance", "পারফিউম"]));
    expect(expander.expand("fragrance")).toEqual(expect.arrayContaining(["attar", "ator", "আতর"]));
    // Built-in groups still don't merge with each other ("ছেলেদের" is in both men and boys).
    expect(expander.expand("men")).not.toContain("boys");
  });

  it("did-you-mean draws on admin terms too", () => {
    expect(createSearchExpander([["oudh", "oud"]]).closest("oudhh")).toBe("oudh");
  });

  it("a group needs two distinct words after normalization", () => {
    expect(searchSynonymSchema.safeParse({ terms: ["Ator", "ator "] }).success).toBe(false);
    expect(searchSynonymSchema.parse({ terms: ["Ator", "#Perfume"] })).toEqual({ terms: ["ator", "perfume"], isActive: true });
  });
});
