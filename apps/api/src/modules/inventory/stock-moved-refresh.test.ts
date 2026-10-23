import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The fill-to-order storefront refresh after stock moves (docs/STOCK_HUB.md §3) is coalesced: a burst of moves refreshes
// once, after a short quiet period, and nothing runs at all when no product is fill to order. stockMovedSettled() runs what
// is still waiting, so tests and the go-live script never wait for the timer.
const mocks = vi.hoisted(() => ({
  refresh: vi.fn(async (_ids: string[]) => [] as string[]),
  exists: vi.fn(async () => true),
}));
vi.mock("../../domain/storefront/read-model.service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../domain/storefront/read-model.service")>()),
  refreshProductsUsingMaterials: (ids: string[]) => mocks.refresh(ids),
  hasFillToOrderProducts: () => mocks.exists(),
}));

import { notifyStockMoved, stockMovedSettled } from "./inventory.service";

beforeEach(() => {
  mocks.refresh.mockClear();
  mocks.exists.mockReset();
  mocks.exists.mockResolvedValue(true);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("refresh after stock moves", () => {
  it("a burst of moves is refreshed once, for every variant moved", async () => {
    notifyStockMoved(["a"]);
    notifyStockMoved(["b", "a"]);
    notifyStockMoved(["c"]);
    expect(mocks.refresh).not.toHaveBeenCalled();
    await stockMovedSettled();
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect([...mocks.refresh.mock.calls[0]![0]].sort()).toEqual(["a", "b", "c"]);
  });

  it("runs on its own after a short quiet period (trailing debounce), and at most 5 s after the first move", async () => {
    vi.useFakeTimers();
    notifyStockMoved(["d"]);
    vi.advanceTimersByTime(1_500);
    notifyStockMoved(["e"]); // the quiet period starts again…
    vi.advanceTimersByTime(1_500);
    expect(mocks.refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(600);
    await vi.waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    expect([...mocks.refresh.mock.calls[0]![0]].sort()).toEqual(["d", "e"]);

    // …but a steady stream of moves still refreshes within 5 s of the first.
    for (let t = 0; t < 5_000; t += 1_000) {
      notifyStockMoved([`s${t}`]);
      vi.advanceTimersByTime(1_000);
    }
    await vi.waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(2));
    await stockMovedSettled();
  });

  it("does nothing when no product is fill to order", async () => {
    mocks.exists.mockResolvedValue(false);
    notifyStockMoved(["f"]);
    await stockMovedSettled();
    expect(mocks.exists).toHaveBeenCalledTimes(1);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
