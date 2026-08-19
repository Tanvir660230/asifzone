import type { ReactNode } from "react";

// Deliberately a sibling of admin/(shell), not nested under it — same reasoning as
// account/(invoice)/layout.tsx: the invoice route needs to print as a standalone document, not
// with the admin header/sidebar around it.
export const dynamic = "force-dynamic";

export default function AdminInvoiceLayout({ children }: { children: ReactNode }) {
  return children;
}
