import type { ReactNode } from "react";
import { StockFrame } from "@/components/admin/stock/stock-side-nav";

/** The Stock section's pages: its grouped menu beside the page on wide screens (components/admin/stock/stock-side-nav.tsx). */
export default function StockSectionLayout({ children }: { children: ReactNode }) {
  return <StockFrame>{children}</StockFrame>;
}
