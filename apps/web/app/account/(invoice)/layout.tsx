import type { ReactNode } from "react";

// Deliberately a sibling of account/(shell), not nested under it — the invoice route needs to
// print as a standalone document (see InvoicePageChrome), not with the storefront header, account
// sidebar, and marketing footer around it. This layout stays a plain passthrough so nothing here
// ever needs a print:hidden guard of its own.
export const dynamic = "force-dynamic";

export default function AccountInvoiceLayout({ children }: { children: ReactNode }) {
  return children;
}
