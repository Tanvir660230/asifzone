import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "../../config/prisma";
import { cleanupFixtures, createStockedProduct, placeOrder } from "../../test-fixtures";

// Thana stays optional at checkout (owner 2026-11-24/25). An empty thana is filled from the written address when the
// reader is sure; a name several districts share, or a thana the shopper picked, is never changed (readBdAddress).

afterAll(async () => {
  await cleanupFixtures();
  await prisma.$disconnect();
});

async function order(overrides: { shippingDistrict?: string; shippingArea?: string; shippingAddressLine: string }) {
  const { variants } = await createStockedProduct({ stocks: [5] });
  return placeOrder([{ variantId: variants[0]!.id, quantity: 1 }], { shippingDivision: "", shippingDistrict: "", shippingArea: "", ...overrides } as never);
}

describe("an order's empty thana is read from the address", () => {
  it("fills it, with the district, when the address names one district's thana", async () => {
    const o = await order({ shippingAddressLine: "Rail gate, Station road, Demra, Dhaka" });
    expect(o).toMatchObject({ shippingDistrict: "Dhaka", shippingArea: "Demra" });
    const b = await order({ shippingAddressLine: "হাসপাতাল রোড, গোবিন্দগঞ্জ" });
    expect(b).toMatchObject({ shippingDistrict: "Gaibandha", shippingArea: "Gobindaganj" });
  });

  it("leaves a shared name (Kaliganj) for the call, and never overwrites a picked thana", async () => {
    const shared = await order({ shippingAddressLine: "School para, main road, Kaliganj" });
    expect(shared.shippingArea).toBe("");
    const picked = await order({ shippingDistrict: "Dhaka", shippingArea: "Adabor", shippingAddressLine: "House 7, Road 2, Matuail, Demra" });
    expect(picked.shippingArea).toBe("Adabor");
  });
});
