import { describe, it, expect } from "vitest";
import { isEmptyClause } from "./test-guard";

// Pure checks only: nothing here talks to a database.
describe("isEmptyClause (the test-cleanup guard)", () => {
  it("flags a where clause that would match every row", () => {
    expect(isEmptyClause(undefined)).toBe(true);
    expect(isEmptyClause(null)).toBe(true);
    expect(isEmptyClause({})).toBe(true);
    // The real accident: a variable that was never assigned because setup failed.
    const categoryId: string | undefined = undefined;
    expect(isEmptyClause({ categoryId })).toBe(true);
    expect(isEmptyClause({ id: undefined, slug: undefined })).toBe(true);
    // An OR with an empty branch matches everything.
    expect(isEmptyClause({ OR: [{ id: { in: ["a"] } }, { categoryId }] })).toBe(true);
  });

  it("lets real filters through, including ones that match nothing", () => {
    expect(isEmptyClause({ id: "abc" })).toBe(false);
    expect(isEmptyClause({ categoryId: "abc", name: undefined })).toBe(false);
    expect(isEmptyClause({ id: { in: [] } })).toBe(false); // an empty list matches no rows
    expect(isEmptyClause({ OR: [{ id: { in: ["a"] } }, { slug: { startsWith: "vt-" } }] })).toBe(false);
    expect(isEmptyClause({ AND: [{ id: "a" }] })).toBe(false);
  });
});
