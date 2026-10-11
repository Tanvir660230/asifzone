import type { ReactNode } from "react";
import { FinanceGroupFrame } from "@/components/admin/finance/finance-group-frame";

/** Finance (Admin V2 IA): a group's pages as an inner list beside the page on wide screens; tabs on phones. */
export default function FinanceLayout({ children }: { children: ReactNode }) {
  return <FinanceGroupFrame>{children}</FinanceGroupFrame>;
}
