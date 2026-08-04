import { describe, it, expect } from "vitest";
import { ensureUniqueSlug } from "./unique-slug";

describe("ensureUniqueSlug", () => {
  it("returns the base slug when it's free", async () => {
    const result = await ensureUniqueSlug("classic-shirt", async () => false);
    expect(result).toBe("classic-shirt");
  });

  it("appends -2 when the base slug is taken", async () => {
    const taken = new Set(["classic-shirt"]);
    const result = await ensureUniqueSlug("classic-shirt", async (slug) => taken.has(slug));
    expect(result).toBe("classic-shirt-2");
  });

  it("keeps incrementing until a free slug is found", async () => {
    const taken = new Set(["classic-shirt", "classic-shirt-2", "classic-shirt-3"]);
    const result = await ensureUniqueSlug("classic-shirt", async (slug) => taken.has(slug));
    expect(result).toBe("classic-shirt-4");
  });
});
