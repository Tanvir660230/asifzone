import { describe, expect, it } from "vitest";
import { createDoorSwapSchema, createOrderIssueSchema } from "@clothing-brand/shared";

const base = { orderItemId: "ckq8x1z0a0000abcd1234efgh", requestedVariantId: "ckq8x1z0a0001abcd1234efgh" };

describe("createDoorSwapSchema", () => {
  it("a damaged-item exchange needs a note saying what proves it", () => {
    const r = createDoorSwapSchema.safeParse({ ...base, reason: "DEFECT" });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe("Say what proves the problem (e.g. WhatsApp photo seen)");
  });
  it("a damaged-item exchange is fine with a note or a reported issue", () => {
    expect(createDoorSwapSchema.safeParse({ ...base, reason: "DEFECT", evidenceNote: "WhatsApp photo: torn sleeve" }).success).toBe(true);
    expect(createDoorSwapSchema.safeParse({ ...base, reason: "DEFECT", issueId: "ckq8x1z0a0002abcd1234efgh" }).success).toBe(true);
  });
  it("a customer's size change needs no note; a negative fee is refused", () => {
    expect(createDoorSwapSchema.safeParse({ ...base, reason: "CUSTOMER_SIZE" }).success).toBe(true);
    expect(createDoorSwapSchema.safeParse({ ...base, reason: "CUSTOMER_SIZE", fee: -1 }).success).toBe(false);
  });
});

describe("createOrderIssueSchema", () => {
  it("needs what the customer said", () => {
    expect(createOrderIssueSchema.safeParse({ kind: "TORN", note: "" }).success).toBe(false);
    expect(createOrderIssueSchema.parse({ kind: "TORN", note: "left sleeve torn" }).channel).toBe("CALL");
  });
});
