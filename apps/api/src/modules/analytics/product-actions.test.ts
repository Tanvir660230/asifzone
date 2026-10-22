import { describe, it, expect } from "vitest";
import { productActions, type ProductSignals, type StoreBaseline } from "./product-actions";

const store: StoreBaseline = { viewToCartRate: 0.04, viewToOrderRate: 0.02, refusalRate: 0.08, currency: "BDT" };
const product = (p: Partial<ProductSignals>): ProductSignals => ({
  id: "p1",
  name: "Panjabi",
  slug: "panjabi",
  views: 0,
  addToCarts: 0,
  orders: 0,
  variants: [],
  deadStockValue: 0,
  parcels: 0,
  refused: 0,
  ...p,
});

describe("productActions", () => {
  it("restock: a selling variant with about a week or less of stock left, most urgent first", () => {
    const a = productActions(
      [
        product({ variants: [{ label: "M", stock: 3, unitsPerDay: 1, unitsSold30: 30 }, { label: "L", stock: 40, unitsPerDay: 1, unitsSold30: 30 }] }),
        product({ id: "p2", name: "Cap", slug: "cap", variants: [{ label: "Black", stock: 1, unitsPerDay: 0.5, unitsSold30: 15 }] }),
      ],
      store,
    );
    expect(a.map((x) => [x.productId, x.kind, x.title])).toEqual([
      ["p2", "restock", "Restock Black — about 2 days left"],
      ["p1", "restock", "Restock M — about 3 days left"],
    ]);
    expect(a[0]!.detail).toBe("1 left, selling about 0.5 a day");
  });

  it("the priority follows the rounded days the title shows (3.03 days reads 'about 3' and is for today)", () => {
    const [a] = productActions([product({ variants: [{ label: "6ml", stock: 9, unitsPerDay: 2.97, unitsSold30: 89 }] })], store);
    expect(a).toMatchObject({ title: "Restock 6ml — about 3 days left", priority: 1 });
  });

  it("within a priority, stock problems come before softer actions", () => {
    const a = productActions(
      [product({ id: "r", parcels: 10, refused: 4 }), product({ id: "s", variants: [{ label: "M", stock: 5, unitsPerDay: 1, unitsSold30: 30 }] })],
      store,
    );
    expect(a.map((x) => x.kind)).toEqual(["restock", "refusals"]);
  });

  it("sold out while still in demand", () => {
    const [a] = productActions([product({ variants: [{ label: "XL", stock: 0, unitsPerDay: 0.4, unitsSold30: 12 }] })], store);
    expect(a).toMatchObject({ kind: "sold_out", title: "XL is sold out", detail: "Ordered 12 times in the last 30 days", priority: 1 });
  });

  it("fix the page: many views, few add to cart (needs enough views to mean anything)", () => {
    const [a] = productActions([product({ views: 800, addToCarts: 8, orders: 3 })], store);
    expect(a).toMatchObject({ kind: "fix_page", detail: "800 views, 1.0% added to cart (store: 4.0%) — check photos, price and size info" });
    expect(productActions([product({ views: 60, addToCarts: 0 })], store)).toEqual([]);
  });

  it("check refusals: refused far more than the store", () => {
    const [a] = productActions([product({ parcels: 10, refused: 4 })], store);
    expect(a).toMatchObject({ kind: "refusals", title: "Refused 40% of the time", detail: "4 of 10 parcels came back (store: 8%) — check it matches the photos and sizes" });
  });

  it("clear stock: money sitting in stock nobody orders", () => {
    const [a] = productActions([product({ deadStockValue: 12000 })], store);
    expect(a).toMatchObject({ kind: "clear_stock", title: "৳12,000 of stock not selling", detail: "No orders in 60 days — discount it, bundle it or stop restocking" });
  });

  it("promote: converts far above the store with room to grow and stock to sell", () => {
    const [a] = productActions([product({ views: 120, addToCarts: 20, orders: 8, variants: [{ label: "M", stock: 50, unitsPerDay: 0.3, unitsSold30: 9 }] })], store);
    expect(a).toMatchObject({ kind: "promote", title: "Converts well — show it to more people", detail: "6.7% of viewers order (store: 2.0%) from only 120 views" });
  });

  it("a healthy product needs nothing", () => {
    expect(productActions([product({ views: 500, addToCarts: 20, orders: 10, parcels: 10, refused: 1, variants: [{ label: "M", stock: 60, unitsPerDay: 0.3, unitsSold30: 9 }] })], store)).toEqual([]);
  });
});
