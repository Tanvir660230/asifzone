"use client";

import { useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Columns3, Download, Inbox, MoreHorizontal } from "lucide-react";
import { Table, TableCell, TableContainer, TableHead, TableHeaderCell, TableMessageRow, TableRow, TableSkeleton } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { DropdownMenu } from "@/components/ui/dropdown-menu";
import { Popover } from "@/components/ui/popover";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { useShortcut } from "@/hooks/use-shortcut";
import { cn } from "@/lib/utils";
import { useColumnVisibility } from "./use-column-visibility";
import type { DataTableColumn, DataTableRowAction, DataTableSort } from "./types";

/**
 * The admin's one data table (P1.7), built on the `Table*` primitives (components/ui/table.tsx). Declarative columns;
 * server-side paging and sorting (the caller owns the query — pair with useUrlState for `page` / `size` / `sort`);
 * selection with bulk actions; per-row actions; column visibility; a card layout below a breakpoint; keyboard control
 * through the shortcut registry while focus is inside the table (J / K move, Enter opens, X selects, . row actions);
 * loading, empty and error states; and a server export hook. New list screens use this instead of bespoke tables.
 */
export interface DataTableProps<Row> {
  /** Accessible name of the table ("Orders", "Customers"). */
  caption: string;
  columns: DataTableColumn<Row>[];
  rows: Row[] | undefined;
  getRowId: (row: Row) => string;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  /** Shown when the query returned no rows. */
  empty?: ReactNode;
  page?: number;
  pageSize?: number;
  total?: number;
  onPageChange?: (page: number) => void;
  sort?: DataTableSort | null;
  /** Header click cycles ascending → descending → unsorted. */
  onSortChange?: (sort: DataTableSort | null) => void;
  selectedIds?: ReadonlySet<string>;
  onSelectionChange?: (ids: Set<string>) => void;
  /** Rendered in the selection bar while rows are selected. */
  bulkActions?: (rows: Row[]) => ReactNode;
  rowActions?: (row: Row) => DataTableRowAction<Row>[];
  /** Row click / Enter. */
  onRowOpen?: (row: Row) => void;
  /** Enables the column picker; the key persists this admin's choice per table. */
  columnPickerKey?: string;
  /** Left side of the toolbar (a FilterBar, a title). */
  toolbar?: ReactNode;
  /** The server export for the current filters (a CSV endpoint) — adds an Export button. */
  onExport?: () => void;
  /** Below this breakpoint rows render as cards. `false` keeps the table (horizontal scroll). */
  cardBelow?: "md" | "lg" | "xl" | false;
  density?: "default" | "dense";
}

const CARD_CLASSES = {
  md: { table: "hidden md:block", cards: "md:hidden" },
  lg: { table: "hidden lg:block", cards: "lg:hidden" },
  xl: { table: "hidden xl:block", cards: "xl:hidden" },
} as const;

export function DataTable<Row>(props: DataTableProps<Row>) {
  const {
    caption,
    columns,
    rows,
    getRowId,
    loading,
    error,
    onRetry,
    empty,
    page = 1,
    pageSize = rows?.length ?? 0,
    total,
    onPageChange,
    sort,
    onSortChange,
    selectedIds,
    onSelectionChange,
    bulkActions,
    rowActions,
    onRowOpen,
    columnPickerKey,
    toolbar,
    onExport,
    cardBelow = "md",
    density = "default",
  } = props;
  const { visible, hidden, toggle } = useColumnVisibility(columns, columnPickerKey);
  const [focused, setFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLButtonElement>(null);
  const list = rows ?? [];
  const selectable = Boolean(onSelectionChange);
  const selected = selectedIds ?? new Set<string>();
  const selectedRows = list.filter((r) => selected.has(getRowId(r)));
  const allSelected = list.length > 0 && list.every((r) => selected.has(getRowId(r)));
  const colSpan = visible.length + (selectable ? 1 : 0) + (rowActions ? 1 : 0);
  const totalPages = total !== undefined && pageSize > 0 ? Math.max(1, Math.ceil(total / pageSize)) : 1;
  const active = activeIndex >= 0 ? list[activeIndex] : undefined;

  function toggleRow(row: Row) {
    if (!onSelectionChange) return;
    const id = getRowId(row);
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectionChange(next);
  }
  function toggleAll() {
    if (!onSelectionChange) return;
    const next = new Set(selected);
    for (const r of list) {
      if (allSelected) next.delete(getRowId(r));
      else next.add(getRowId(r));
    }
    onSelectionChange(next);
  }
  function cycleSort(column: string) {
    if (!onSortChange) return;
    if (sort?.column !== column) onSortChange({ column, dir: "asc" });
    else if (sort.dir === "asc") onSortChange({ column, dir: "desc" });
    else onSortChange(null);
  }

  // Keyboard control — bound only while focus is inside this table, so two tables never fight over J/K.
  const keys = { enabled: focused && list.length > 0 };
  useShortcut("list.next", () => setActiveIndex((i) => Math.min(i + 1, list.length - 1)), keys);
  useShortcut("list.prev", () => setActiveIndex((i) => Math.max(i - 1, 0)), keys);
  useShortcut("list.open", () => active && onRowOpen?.(active), { enabled: keys.enabled && Boolean(onRowOpen) && Boolean(active) });
  useShortcut("list.select", () => active && toggleRow(active), { enabled: keys.enabled && selectable && Boolean(active) });
  useShortcut("list.actions", () => active && setMenuFor(getRowId(active)), { enabled: keys.enabled && Boolean(rowActions) && Boolean(active) });

  const body = (() => {
    if (loading && !rows) return <TableSkeleton rows={Math.min(pageSize || 8, 8)} cols={colSpan} />;
    if (error)
      return (
        <TableMessageRow colSpan={colSpan}>
          <ErrorState onRetry={onRetry} />
        </TableMessageRow>
      );
    if (list.length === 0) return <TableMessageRow colSpan={colSpan}>{empty ?? <EmptyState icon={Inbox} title="Nothing here yet" />}</TableMessageRow>;
    return list.map((row, index) => {
      const id = getRowId(row);
      const isSelected = selected.has(id);
      return (
        <TableRow
          key={id}
          interactive={Boolean(onRowOpen)}
          data-active={index === activeIndex || undefined}
          aria-selected={selectable ? isSelected : undefined}
          onClick={onRowOpen ? () => onRowOpen(row) : undefined}
          className={cn(density === "dense" ? "h-row-dense" : "h-row", index === activeIndex && "bg-ink-50 outline outline-1 -outline-offset-1 outline-ink-300", isSelected && "bg-info-50/60")}
        >
          {selectable && (
            <TableCell className="w-10 py-0" onClick={(e) => e.stopPropagation()}>
              <Checkbox checked={isSelected} onChange={() => toggleRow(row)} aria-label={`Select row ${index + 1}`} />
            </TableCell>
          )}
          {visible.map((col) => (
            <TableCell key={col.id} align={col.align} className="py-1.5">
              {col.cell(row)}
            </TableCell>
          ))}
          {rowActions && (
            <TableCell className="w-12 py-0 text-right" onClick={(e) => e.stopPropagation()}>
              <RowActionsMenu row={row} id={id} actions={rowActions(row)} open={menuFor === id} onOpen={() => setMenuFor(id)} onClose={() => setMenuFor(null)} />
            </TableCell>
          )}
        </TableRow>
      );
    });
  })();

  const titleColumn = visible.find((c) => c.card === "title") ?? visible[0];
  const metaColumns = visible.filter((c) => c !== titleColumn && c.card !== "hidden");
  const cards = cardBelow ? CARD_CLASSES[cardBelow] : null;

  return (
    <section aria-label={caption} className="space-y-3">
      {(toolbar || columnPickerKey || onExport) && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1">{toolbar}</div>
          {onExport && (
            <Button variant="outline" size="sm" onClick={onExport}>
              <Download size={14} /> Export
            </Button>
          )}
          {columnPickerKey && (
            <>
              <Button ref={pickerRef} variant="outline" size="sm" onClick={() => setPickerOpen((o) => !o)} aria-haspopup="dialog" aria-expanded={pickerOpen}>
                <Columns3 size={14} /> Columns
              </Button>
              <Popover open={pickerOpen} onClose={() => setPickerOpen(false)} anchorRef={pickerRef} align="end" className="w-56 p-2">
                <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-400">Show columns</p>
                {columns.map((col, i) => (
                  <label key={col.id} className={cn("flex items-center gap-2 rounded-md px-2 py-1.5 text-sm", i === 0 || col.hideable === false ? "opacity-60" : "cursor-pointer hover:bg-ink-50")}>
                    <Checkbox checked={!hidden.has(col.id) || i === 0 || col.hideable === false} disabled={i === 0 || col.hideable === false} onChange={() => toggle(col.id)} />
                    {col.label ?? (typeof col.header === "string" ? col.header : col.id)}
                  </label>
                ))}
              </Popover>
            </>
          )}
        </div>
      )}

      {selectable && selectedRows.length > 0 && (
        <div role="region" aria-label="Selection" className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-sm">
          <span className="font-medium text-ink-800">{selectedRows.length} selected</span>
          <button type="button" className="text-xs text-ink-500 underline-offset-2 hover:underline" onClick={() => onSelectionChange?.(new Set())}>
            Clear
          </button>
          <div className="ml-auto flex flex-wrap items-center gap-2">{bulkActions?.(selectedRows)}</div>
        </div>
      )}

      <div
        className={cn(cards?.table)}
        onFocus={() => setFocused(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
        }}
      >
        <TableContainer>
          <Table aria-label={caption} aria-rowcount={total} tabIndex={0} className="focus:outline-none">
            <TableHead>
              <tr>
                {selectable && (
                  <TableHeaderCell className="w-10">
                    <Checkbox checked={allSelected} onChange={toggleAll} aria-label="Select all rows on this page" disabled={list.length === 0} />
                  </TableHeaderCell>
                )}
                {visible.map((col) => {
                  const sorted = sort?.column === col.id ? sort.dir : null;
                  const Icon = sorted === "asc" ? ArrowUp : sorted === "desc" ? ArrowDown : ArrowUpDown;
                  return (
                    <TableHeaderCell key={col.id} align={col.align} className={col.className} aria-sort={col.sortable ? (sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : "none") : undefined}>
                      {col.sortable && onSortChange ? (
                        <button type="button" onClick={() => cycleSort(col.id)} className={cn("inline-flex items-center gap-1 uppercase tracking-wide", sorted ? "text-ink-900" : "hover:text-ink-800")}>
                          {col.header}
                          <Icon size={12} aria-hidden />
                        </button>
                      ) : (
                        col.header
                      )}
                    </TableHeaderCell>
                  );
                })}
                {rowActions && <TableHeaderCell className="w-12"><span className="sr-only">Actions</span></TableHeaderCell>}
              </tr>
            </TableHead>
            <tbody>{body}</tbody>
          </Table>
        </TableContainer>
      </div>

      {cards && (
        <ul className={cn("space-y-2", cards.cards)} aria-label={caption}>
          {loading && !rows ? (
            <li className="h-24 animate-pulse rounded-xl bg-ink-50" aria-hidden />
          ) : error ? (
            <li>
              <ErrorState onRetry={onRetry} variant="bordered" />
            </li>
          ) : list.length === 0 ? (
            <li>{empty ?? <EmptyState icon={Inbox} title="Nothing here yet" variant="bordered" />}</li>
          ) : (
            list.map((row) => {
              const id = getRowId(row);
              return (
                <li key={id} className="rounded-xl border border-line bg-surface p-3">
                  <div className="flex items-start gap-3">
                    {selectable && <Checkbox checked={selected.has(id)} onChange={() => toggleRow(row)} aria-label="Select" className="mt-0.5" />}
                    <button type="button" disabled={!onRowOpen} onClick={() => onRowOpen?.(row)} className="min-w-0 flex-1 text-left">
                      <div className="text-sm font-medium text-ink-900">{titleColumn?.cell(row)}</div>
                      <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                        {metaColumns.map((col) => (
                          <div key={col.id} className="min-w-0">
                            <dt className="text-ink-400">{col.label ?? (typeof col.header === "string" ? col.header : col.id)}</dt>
                            <dd className="truncate text-ink-700">{col.cell(row)}</dd>
                          </div>
                        ))}
                      </dl>
                    </button>
                    {rowActions && <RowActionsMenu row={row} id={`card-${id}`} actions={rowActions(row)} open={menuFor === `card-${id}`} onOpen={() => setMenuFor(`card-${id}`)} onClose={() => setMenuFor(null)} />}
                  </div>
                </li>
              );
            })
          )}
        </ul>
      )}

      {total !== undefined && total > 0 && onPageChange && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-500">
          <span className="tabular-nums">
            {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
          </span>
          <Pagination page={page} totalPages={totalPages} onChange={onPageChange} className="mt-0" />
        </div>
      )}
    </section>
  );
}

function RowActionsMenu<Row>({
  row,
  id,
  actions,
  open,
  onOpen,
  onClose,
}: {
  row: Row;
  id: string;
  actions: DataTableRowAction<Row>[];
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  const anchor = useRef<HTMLButtonElement | null>(null);
  if (actions.length === 0) return null;
  return (
    <>
      <IconButton
        ref={anchor}
        data-row-actions={id}
        size="sm"
        aria-label="Row actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={open ? onClose : onOpen}
      >
        <MoreHorizontal size={16} />
      </IconButton>
      <DropdownMenu
        open={open}
        onClose={onClose}
        anchorRef={anchor}
        items={actions.map((a) => ({ label: a.label, icon: a.icon, destructive: a.destructive, disabled: a.disabled, onClick: () => a.onSelect(row) }))}
      />
    </>
  );
}
