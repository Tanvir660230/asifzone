import { describe, expect, it } from "vitest";
import { guessPartialReturn } from "@clothing-brand/shared";

// "Settle part deliveries": the courier collected ৳X; which units did the customer keep? One exact fit is offered as a
// suggestion, otherwise nothing is guessed.

const caps = [
  { id: "black", quantity: 1, unitPrice: 999 },
  { id: "white", quantity: 1, unitPrice: 999 },
  { id: "attar", quantity: 1, unitPrice: 450 },
];

describe("guessPartialReturn", () => {
  it("finds the single split that matches what was collected, delivery included", () => {
    // Kept the attar only, paid ৳450 + ৳70 delivery.
    expect(guessPartialReturn(caps, 520, 70)).toEqual({ returned: { black: 1, white: 1, attar: 0 }, withDelivery: true });
  });

  it("also when the delivery charge wasn't collected", () => {
    expect(guessPartialReturn(caps, 450, 70)).toEqual({ returned: { black: 1, white: 1, attar: 0 }, withDelivery: false });
  });

  it("works with quantities", () => {
    expect(guessPartialReturn([{ id: "a", quantity: 3, unitPrice: 300 }], 670, 70)).toEqual({ returned: { a: 1 }, withDelivery: true });
  });

  it("gives up when two splits fit (black or white cap — same price) or none does", () => {
    expect(guessPartialReturn(caps, 1069, 70)).toBeNull();
    expect(guessPartialReturn(caps, 333, 70)).toBeNull();
  });

  it("never calls 'kept all' or 'kept nothing' a partial, and needs a collected amount", () => {
    expect(guessPartialReturn([{ id: "a", quantity: 1, unitPrice: 500 }], 570, 70)).toBeNull();
    expect(guessPartialReturn(caps, null, 70)).toBeNull();
    expect(guessPartialReturn(caps, 0, 70)).toBeNull();
    expect(guessPartialReturn([], 500, 70)).toBeNull();
  });

  it("allows a taka of rounding", () => {
    expect(guessPartialReturn(caps, 519.5, 70)?.returned).toEqual({ black: 1, white: 1, attar: 0 });
  });
});
