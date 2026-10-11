import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/** One declarative column of a DataTable (components/admin/data-table/data-table.tsx). */
export interface DataTableColumn<Row> {
  /** Stable id — also the sort key sent to the server when `sortable`, and the column-visibility key. */
  id: string;
  header: ReactNode;
  /** Plain-text header for the column picker and card labels when `header` isn't a string. */
  label?: string;
  cell: (row: Row) => ReactNode;
  sortable?: boolean;
  align?: "left" | "right" | "center";
  /** Tailwind width / min-width classes for the header cell. */
  className?: string;
  /** Can be hidden from the column picker. Default true; the first column never hides. */
  hideable?: boolean;
  defaultHidden?: boolean;
  /** In card mode: `title` heads the card, `meta` is listed, `hidden` is left out. Default `meta`. */
  card?: "title" | "meta" | "hidden";
}

export interface DataTableRowAction<Row> {
  label: string;
  icon?: LucideIcon;
  onSelect: (row: Row) => void;
  destructive?: boolean;
  disabled?: boolean;
}

export interface DataTableSort {
  column: string;
  dir: "asc" | "desc";
}
