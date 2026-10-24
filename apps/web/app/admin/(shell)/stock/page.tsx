import { Suspense } from "react";
import { StockHub } from "@/components/admin/stock/stock-hub";

/** Stock (docs/STOCK_HUB.md §7): Today — what to fill, reorder, count and approve — then every item in one list. The list's
 * filters live in the URL, so the page renders under Suspense (useSearchParams). */
export default function StockPage() {
  return (
    <Suspense>
      <StockHub />
    </Suspense>
  );
}
