import type { ReactNode } from "react";
import { StorefrontShell } from "@/components/storefront/storefront-shell";

// Deliberately no loading.tsx in this group (see storefront-shell.tsx's comment) — product/[slug]
// and category/[slug] live here specifically so a missing slug's notFound() can still turn into a
// real 404 instead of a soft 200.
export default function StorefrontDetailLayout({ children }: { children: ReactNode }) {
  return <StorefrontShell>{children}</StorefrontShell>;
}
