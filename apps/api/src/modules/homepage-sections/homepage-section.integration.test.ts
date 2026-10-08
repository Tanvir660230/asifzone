import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "../../config/prisma";
import { asOwner } from "../../test-fixtures";

// The default homepage sections are created with fixed ids ("seed-hero", …), not cuids. Reordering must accept them —
// the service already checks the ids are exactly the existing sections.

afterAll(async () => {
  await prisma.$disconnect();
});

describe("homepage sections reorder", () => {
  it("reorders sections whose ids are the seeded defaults, and rejects an incomplete list", async () => {
    const owner = await asOwner();
    const list = await owner.get("/api/homepage-sections");
    expect(list.status).toBe(200);
    const original: string[] = list.body.sections.map((s: { id: string }) => s.id);
    expect(original.length).toBeGreaterThan(1);
    expect(original.some((id) => id.startsWith("seed-"))).toBe(true);

    const swapped = [original[1]!, original[0]!, ...original.slice(2)];
    try {
      const res = await owner.patch("/api/homepage-sections/reorder", { ids: swapped });
      expect(res.status).toBe(200);
      expect(res.body.sections.map((s: { id: string }) => s.id)).toEqual(swapped);
      expect((await owner.patch("/api/homepage-sections/reorder", { ids: swapped.slice(1) })).status).toBe(400);
    } finally {
      await owner.patch("/api/homepage-sections/reorder", { ids: original });
    }
  });
});
