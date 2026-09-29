import { describe, it, expect } from "vitest";
import {
  allowedNextOrderStatuses,
  canTransitionOrder,
  flashSalePhase,
  getOrderTransition,
  isPurchasable,
  orderStatusEnum,
  taxIncludedIn,
  amountExcludingTax,
  type OrderStatus,
} from "@clothing-brand/shared";

// Pure rules shared by the API and the admin UI (docs/ORDER_STATE_MACHINE.md, TARGET_ARCHITECTURE §16a,
// docs/PRICING_PIPELINE.md §3).

const ALL = orderStatusEnum.options as OrderStatus[];

describe("order transition matrix", () => {
  it("closed statuses never reopen; REFUNDED is terminal", () => {
    for (const closed of ["CANCELLED", "RETURNED"] as const) expect(allowedNextOrderStatuses(closed)).toEqual(["REFUNDED"]);
    expect(allowedNextOrderStatuses("REFUNDED")).toEqual([]);
    expect(canTransitionOrder("CANCELLED", "CONFIRMED")).toBe(false);
  });

  it("same-status is an allowed no-op with no effects", () => {
    for (const s of ALL) {
      const rule = getOrderTransition(s, s)!;
      expect(rule.id).toBe("T0");
      expect([rule.stock, rule.codCollected, rule.customerSms, rule.awardPoints, rule.courierLoss]).toEqual(["none", false, null, false, false]);
    }
  });

  it("declares the stock, payment and notification effects of each kind of move", () => {
    expect(getOrderTransition("PACKED", "CANCELLED")).toMatchObject({ stock: "release", courierLoss: true, customerSms: "CANCELLED", alertIfPaid: "order.cancelled_but_paid" });
    expect(getOrderTransition("DELIVERED", "RETURNED")).toMatchObject({ stock: "return", alertIfPaid: "order.returned_refund_due" });
    expect(getOrderTransition("SHIPPED", "DELIVERED")).toMatchObject({ stock: "none", codCollected: true, awardPoints: true, customerSms: "DELIVERED" });
    for (const from of ["DELIVERED", "PARTIALLY_DELIVERED", "CANCELLED", "RETURNED"] as const) {
      expect(getOrderTransition(from, "REFUNDED")).toMatchObject({ stock: "none", requiresRecordedRefund: true });
    }
    expect(getOrderTransition("PENDING", "CONFIRMED")).toMatchObject({ stock: "none", customerSms: "CONFIRMED" });
  });

  it("only the listed moves exist (spot-check of refused ones)", () => {
    const refused: Array<[OrderStatus, OrderStatus]> = [
      ["DELIVERED", "CANCELLED"], ["DELIVERED", "SHIPPED"], ["SHIPPED", "CONFIRMED"], ["PARTIALLY_DELIVERED", "DELIVERED"],
      ["PENDING", "RETURNED"], ["PENDING", "REFUNDED"], ["RETURNED", "CANCELLED"],
    ];
    for (const [from, to] of refused) expect(canTransitionOrder(from, to), `${from} → ${to}`).toBe(false);
  });

  it("no transition restocks without first holding stock, and nothing restocks from a closed status", () => {
    for (const from of ALL) for (const to of ALL) {
      const rule = getOrderTransition(from, to);
      if (rule && rule.stock !== "none") expect(["CANCELLED", "RETURNED", "REFUNDED"]).not.toContain(from);
    }
  });
});

describe("purchasability", () => {
  it("requires published, not trashed, and an active variant", () => {
    expect(isPurchasable({ isActive: true, deletedAt: null }, { isActive: true })).toBe(true);
    expect(isPurchasable({ isActive: true, deletedAt: new Date() }, { isActive: true })).toBe(false);
    expect(isPurchasable({ isActive: false, deletedAt: null }, { isActive: true })).toBe(false);
    expect(isPurchasable({ isActive: true, deletedAt: null }, { isActive: false })).toBe(false);
  });
});

describe("flash sale phase", () => {
  const now = new Date("2026-09-28T12:00:00Z");
  const at = (min: number) => new Date(now.getTime() + min * 60_000);
  it("derives live only from enabled + window", () => {
    expect(flashSalePhase({ enabled: true, startsAt: at(-5), endsAt: at(5) }, now)).toBe("LIVE");
    expect(flashSalePhase({ enabled: false, startsAt: at(-5), endsAt: at(5) }, now)).toBe("DISABLED");
    expect(flashSalePhase({ enabled: true, startsAt: at(5), endsAt: at(10) }, now)).toBe("SCHEDULED");
    expect(flashSalePhase({ enabled: true, startsAt: at(-10), endsAt: at(-5) }, now)).toBe("ENDED");
    expect(flashSalePhase({ enabled: false, startsAt: at(-10), endsAt: at(-5) }, now)).toBe("ENDED");
  });
});

describe("tax-inclusive VAT (D3)", () => {
  it("extracts the VAT contained in an inclusive amount, never adds it", () => {
    expect(taxIncludedIn(115, 15)).toBeCloseTo(15, 10);
    expect(amountExcludingTax(115, 15)).toBeCloseTo(100, 10);
    expect(taxIncludedIn(1000, 0)).toBe(0);
    // The old analytics estimate used 1000 × 15% = 150 for tax-inclusive revenue; the contained VAT is 130.43
    // (rounded to the paisa by the central rounding policy since Phase 2).
    expect(taxIncludedIn(1000, 15)).toBe(130.43);
  });
});
