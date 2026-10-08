"use client";

import { useState, type ReactNode } from "react";
import { Table, TableCell, TableContainer, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";

export interface ChartTableData {
  caption: string;
  columns: ReadonlyArray<{ label: string; align?: "left" | "right" }>;
  rows: ReadonlyArray<{ key: string; cells: ReadonlyArray<ReactNode> }>;
}

/**
 * Blueprint V2 §Y: every chart has a text summary and a "View as table" toggle. The summary is the chart's accessible
 * description; the drawing itself is hidden from screen readers (it's pointer-only), and the table shows the same
 * numbers for anyone who'd rather read them.
 */
export function ChartFrame({ summary, table, children }: { summary: string; table: ChartTableData; children: ReactNode }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <figure className="relative">
      <figcaption className="sr-only">{summary}</figcaption>
      <div className="mb-2 flex justify-end">
        <button
          type="button"
          aria-pressed={asTable}
          onClick={() => setAsTable((v) => !v)}
          className="rounded-md px-1.5 py-1 text-[13px] font-medium text-accent transition-colors duration-fast hover:bg-accent/[0.06] hover:text-accent-hover"
        >
          {asTable ? "View as chart" : "View as table"}
        </button>
      </div>
      {asTable ? (
        <TableContainer className="max-h-[17.5rem] overflow-y-auto">
          <Table>
            <caption className="sr-only">{table.caption}</caption>
            <TableHead>
              <tr>
                {table.columns.map((c) => (
                  <TableHeaderCell key={c.label} scope="col" align={c.align}>
                    {c.label}
                  </TableHeaderCell>
                ))}
              </tr>
            </TableHead>
            <tbody>
              {table.rows.map((row) => (
                <TableRow key={row.key}>
                  {row.cells.map((cell, i) => (
                    <TableCell key={table.columns[i]?.label ?? i} align={table.columns[i]?.align} className="tabular-nums">
                      {cell}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </tbody>
          </Table>
        </TableContainer>
      ) : (
        <div aria-hidden="true">{children}</div>
      )}
    </figure>
  );
}
