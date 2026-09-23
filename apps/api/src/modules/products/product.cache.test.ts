import { describe, expect, it } from "vitest";
import { buildRevalidationTags, triggerStorefrontRevalidation } from "./product.cache";
import { env } from "../../config/env";

describe("buildRevalidationTags", () => {
  it("always includes the listing tag alongside one per id and per slug", () => {
    expect(buildRevalidationTags(["p1"], ["black-panjabi"])).toEqual(["products:listing", "product:p1", "product:black-panjabi"]);
  });

  it("dedupes ids/slugs that resolve to the same tag", () => {
    const tags = buildRevalidationTags(["p1", "p1"], ["black-panjabi", "black-panjabi"]);
    expect(tags).toEqual(["products:listing", "product:p1", "product:black-panjabi"]);
  });

  it("still returns just the listing tag with nothing product-specific", () => {
    expect(buildRevalidationTags([], [])).toEqual(["products:listing"]);
  });

  it("covers a bulk operation's several ids and an old+new slug pair from a rename", () => {
    const tags = buildRevalidationTags(["p1", "p2"], ["old-slug", "new-slug"]);
    expect(tags).toEqual(["products:listing", "product:p1", "product:p2", "product:old-slug", "product:new-slug"]);
  });
});

describe("triggerStorefrontRevalidation", () => {
  it("is a safe no-op when REVALIDATE_SECRET isn't configured — the default in dev/CI/test", async () => {
    expect(env.revalidateSecret).toBe(""); // this test only means something if the fallback is what's actually active
    await expect(triggerStorefrontRevalidation({ productId: "p1", slug: "x" })).resolves.toBeUndefined();
    await expect(triggerStorefrontRevalidation()).resolves.toBeUndefined();
  });
});
