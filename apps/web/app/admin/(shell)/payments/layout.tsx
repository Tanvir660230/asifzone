import type { ReactNode } from "react";
import { FinanceGroupFrame } from "@/components/admin/finance/finance-group-frame";

/** Payments' pages belong to Finance › Sales & payments — the same inner list beside the page as the other finance groups. */
export default function PaymentsLayout({ children }: { children: ReactNode }) {
  return <FinanceGroupFrame>{children}</FinanceGroupFrame>;
}
