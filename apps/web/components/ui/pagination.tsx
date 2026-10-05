import { ChevronLeft, ChevronRight } from "lucide-react";
import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils";

/** Shared look for one page step (number or arrow) — used by the button pagination below and by
 * the storefront's link-based pagination. */
export const paginationItemVariants = cva(
  "flex h-8 min-w-8 items-center justify-center rounded-full px-2 text-sm tabular-nums transition-colors duration-fast ease-smooth disabled:pointer-events-none disabled:opacity-30 aria-disabled:pointer-events-none aria-disabled:opacity-30",
  {
    variants: {
      active: {
        true: "bg-accent font-medium text-accent-fg shadow-sm",
        false: "text-ink-600 hover:bg-ink-900/[0.05] hover:text-fg",
      },
    },
    defaultVariants: { active: false },
  },
);

/** Windowed page numbers with ellipses — always first, last, current and its neighbors. */
export function pageWindow(page: number, totalPages: number): (number | "…")[] {
  const pages = new Set<number>([1, totalPages, page, page - 1, page + 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b);
  const result: (number | "…")[] = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i]! - sorted[i - 1]! > 1) result.push("…");
    result.push(sorted[i]!);
  }
  return result;
}

interface PaginationProps {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
  className?: string;
}

/** State-driven pagination for admin lists. */
export function Pagination({ page, totalPages, onChange, className }: PaginationProps) {
  if (totalPages <= 1) return null;

  return (
    <nav className={cn("mt-4 flex items-center justify-end gap-1", className)} aria-label="Pagination">
      <button onClick={() => onChange(page - 1)} disabled={page <= 1} aria-label="Previous page" className={paginationItemVariants()}>
        <ChevronLeft size={16} />
      </button>
      {pageWindow(page, totalPages).map((p, i) =>
        p === "…" ? (
          <span key={`ellipsis-${i}`} className="px-1.5 text-sm text-fg-subtle" aria-hidden="true">
            …
          </span>
        ) : (
          <button
            key={p}
            onClick={() => onChange(p)}
            aria-current={p === page ? "page" : undefined}
            aria-label={`Page ${p}`}
            className={paginationItemVariants({ active: p === page })}
          >
            {p}
          </button>
        ),
      )}
      <button onClick={() => onChange(page + 1)} disabled={page >= totalPages} aria-label="Next page" className={paginationItemVariants()}>
        <ChevronRight size={16} />
      </button>
    </nav>
  );
}
