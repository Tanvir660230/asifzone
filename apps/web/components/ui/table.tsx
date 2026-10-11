import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { HScrollShadow } from "./h-scroll-shadow";
import { Skeleton } from "./skeleton";

/**
 * Data-table primitives: thin semantic wrappers over the `.ui-table*` recipes in globals.css, so a
 * table built from these and legacy markup using the same classes look identical.
 *
 *   <TableContainer>
 *     <Table className="min-w-[640px]">
 *       <TableHead><tr><TableHeaderCell>Name</TableHeaderCell></tr></TableHead>
 *       <tbody>{rows.map((r) => <TableRow key={r.id} interactive><TableCell>{r.name}</TableCell></TableRow>)}</tbody>
 *     </Table>
 *   </TableContainer>
 */

type Align = "left" | "right" | "center";

/** Rounded, bordered frame with horizontal scroll (and edge fades) on narrow screens. */
export function TableContainer({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("ui-table-container", className)}>
      <HScrollShadow className="overflow-x-auto" edgeFrom="from-surface">
        {children}
      </HScrollShadow>
    </div>
  );
}

export function Table({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  return <table className={cn("ui-table", className)} {...props} />;
}

export function TableHead({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn("ui-table-head", className)} {...props} />;
}

export function TableHeaderCell({ className, align, ...props }: ThHTMLAttributes<HTMLTableCellElement> & { align?: Align }) {
  return (
    <th scope="col" className={cn("px-4 py-3", align === "right" && "text-right", align === "center" && "text-center", className)} {...props} />
  );
}

export function TableRow({ className, interactive, ...props }: HTMLAttributes<HTMLTableRowElement> & { interactive?: boolean }) {
  return <tr className={cn("ui-table-row", interactive && "ui-table-row-interactive", className)} {...props} />;
}

export function TableCell({ className, align, ...props }: TdHTMLAttributes<HTMLTableCellElement> & { align?: Align }) {
  return (
    <td className={cn("px-4 py-3", align === "right" && "text-right tabular-nums", align === "center" && "text-center", className)} {...props} />
  );
}

/** A full-width row for an empty / error state inside the table body. */
export function TableMessageRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan}>{children}</td>
    </tr>
  );
}

/** Placeholder rows while a table loads. */
export function TableSkeleton({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r} className="ui-table-row" aria-hidden="true">
          {Array.from({ length: cols }).map((_, c) => (
            <td key={c} className="px-4 py-3">
              <Skeleton className="h-4" style={{ width: c === 0 ? "70%" : "50%" }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
