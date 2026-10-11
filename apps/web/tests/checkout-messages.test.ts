import { describe, expect, it } from "vitest";
import { checkoutSchema } from "@clothing-brand/shared";

// The checkout form renders the schema's messages to shoppers verbatim (app/(storefront)/checkout/page.tsx), so none of
// them may be Zod's developer defaults ("String must contain at least 1 character(s)").
function messagesFor(input: Record<string, unknown>) {
  const result = checkoutSchema.safeParse(input);
  if (result.success) return {};
  return Object.fromEntries(result.error.issues.map((issue) => [issue.path.join("."), issue.message]));
}

const blank = {
  items: [{ variantId: "cjld2cjxh0000qzrmn831i7rn", quantity: 1 }],
  customerName: "   ",
  customerEmail: "a@b",
  customerPhone: "123",
  shippingDivision: "",
  shippingDistrict: "",
  shippingArea: "",
  shippingAddressLine: " ",
  paymentMethod: "COD",
};

describe("checkout validation messages", () => {
  it("tells the shopper what to fix for every field the form shows", () => {
    expect(messagesFor(blank)).toMatchObject({
      customerName: "Enter your full name",
      customerEmail: "Enter a valid email address, or leave it empty",
      customerPhone: expect.stringMatching(/phone/i),
      shippingDivision: "Choose your district",
      shippingDistrict: "Choose your district",
      shippingArea: "Choose your area or thana",
      shippingAddressLine: "Enter your house, road and area",
    });
  });

  it("never shows a Zod default message", () => {
    for (const message of Object.values(messagesFor(blank))) {
      expect(message).not.toMatch(/String must|Invalid enum|Required|Expected/);
    }
  });

  it("still accepts a complete order and an empty optional email", () => {
    const ok = checkoutSchema.safeParse({
      ...blank,
      customerName: "Rahim Uddin",
      customerEmail: "",
      customerPhone: "01712345678",
      shippingDivision: "Dhaka",
      shippingDistrict: "Dhaka",
      shippingArea: "Mirpur",
      shippingAddressLine: "House 1, Road 2",
    });
    expect(ok.success).toBe(true);
  });
});
