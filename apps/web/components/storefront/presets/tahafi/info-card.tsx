import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A white card with soft depth, like a grouped list on an iPhone — the product page's delivery dates and promises. */
export function InfoCard({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("rounded-[1.375rem] bg-surface p-4 shadow-[var(--panel-shadow)] sm:p-5", className)}>{children}</div>;
}
