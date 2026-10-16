"use client";

import { useEffect } from "react";
import { useMediaQuery } from "@/hooks/use-media-query";

/**
 * Phones: every Store Console table with three or more visible columns reads as a list of cards — one card per row, the
 * first column as its title, each other value beside its column's name — instead of a table you scroll sideways. The
 * layout is CSS (globals.css, `table[data-stack="on"]`); this only copies each column's header into its cells
 * (`data-label`) and keeps doing so as rows load. Sort buttons in the header stay, as a row of chips above the cards.
 * A table that must stay a grid (a cohort matrix) opts out with `data-no-stack` on itself or an ancestor.
 */
export function PhoneTables() {
  const phone = useMediaQuery("(max-width: 639px)");

  useEffect(() => {
    if (!phone) {
      document.querySelectorAll<HTMLTableElement>("table[data-stack]").forEach(unstack);
      return;
    }
    let frame = 0;
    const apply = () => {
      frame = 0;
      // Tables in drawers and dialogs portal into <body>, so look there, not only in <main>.
      for (const table of document.body.querySelectorAll<HTMLTableElement>("table")) {
        if (table.closest("[data-no-stack]")) continue;
        const columns = table.dataset.stack ? readColumns(table) : measure(table);
        if (!columns || table.dataset.stack !== "on") continue;
        for (const body of Array.from(table.tBodies)) {
          for (const row of Array.from(body.rows)) {
            // A single cell across the whole row is a message (empty state, loading) — shown as it is.
            if (row.cells.length === 1 && row.cells[0]!.colSpan > 1) {
              row.cells[0]!.dataset.stackFull = "";
              continue;
            }
            let column = 0;
            let titled = false;
            for (const cell of Array.from(row.cells)) {
              const label = columns.labels[column] ?? "";
              if (cell.dataset.label !== label) cell.dataset.label = label;
              const hidden = columns.hidden.includes(column);
              if (hidden) cell.dataset.colHidden = "";
              column += cell.colSpan;
              if (hidden) continue;
              const kind = cellKind(cell, label, titled);
              if (kind === "title") titled = true;
              if (kind) {
                if (cell.dataset.cell !== kind) cell.dataset.cell = kind;
              } else if (cell.dataset.cell) delete cell.dataset.cell;
            }
          }
        }
      }
    };
    apply();
    const observer = new MutationObserver(() => {
      if (!frame) frame = requestAnimationFrame(apply);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [phone]);

  return null;
}

const EMPTY_VALUES = new Set(["", "—", "–", "-"]);

/** How a cell sits in its card: the leading selection checkbox, the title (the first cell with something to read), a
 * value with nothing in it ("—", left out), the row's buttons (closing the last line), a status pill that names itself
 * (no "State" / "Active" label before it), or a plain "label value" pair. */
function cellKind(cell: HTMLTableCellElement, label: string, titled: boolean): "select" | "title" | "empty" | "action" | "badge" | null {
  const text = (cell.textContent ?? "").replace(/\s+/g, " ").trim();
  const media = cell.querySelector("img, picture, svg, canvas");
  const control = cell.querySelector("button, a[href], [role='button'], select, input:not([type='checkbox'])");
  if (!titled) {
    if (!text && !control && cell.querySelector("input[type='checkbox']")) return "select";
    if (text || media) return "title";
  }
  if (EMPTY_VALUES.has(text) && !media && !control) return "empty";
  if (control && (!label || /^actions?$/i.test(label) || !text)) return "action";
  const pills = Array.from(cell.querySelectorAll(".rounded-full"));
  if (!control && pills.some((pill) => (pill.textContent ?? "").replace(/\s+/g, " ").trim() === text)) return "badge";
  return null;
}

interface Columns {
  labels: string[];
  hidden: number[];
}

/** First sight of a table on a phone: which columns it shows (some hide below sm) and what they're called. Measured
 * before the card layout applies, while the cells still have their own display. */
function measure(table: HTMLTableElement): Columns | null {
  const head = table.tHead?.rows[0];
  // Not on screen (a desktop-only table while the phone cards show): look again when it is.
  if (!head || table.offsetParent === null) return null;
  const labels: string[] = [];
  const hidden: number[] = [];
  for (const th of Array.from(head.cells)) {
    const shown = getComputedStyle(th).display !== "none";
    for (let i = 0; i < th.colSpan; i++) {
      if (!shown) hidden.push(labels.length);
      labels.push(i === 0 ? (th.textContent ?? "").replace(/\s+/g, " ").trim() : "");
    }
  }
  if (labels.length - hidden.length < 3) {
    // Two columns fit a phone as they are.
    table.dataset.stack = "off";
    return null;
  }
  table.dataset.stackLabels = JSON.stringify(labels);
  table.dataset.stackHidden = hidden.join(",");
  table.dataset.stack = "on";
  return { labels, hidden };
}

function readColumns(table: HTMLTableElement): Columns | null {
  if (table.dataset.stack !== "on") return null;
  return {
    labels: JSON.parse(table.dataset.stackLabels ?? "[]") as string[],
    hidden: (table.dataset.stackHidden ?? "").split(",").filter(Boolean).map(Number),
  };
}

function unstack(table: HTMLTableElement) {
  delete table.dataset.stack;
  delete table.dataset.stackLabels;
  delete table.dataset.stackHidden;
  table.querySelectorAll<HTMLElement>("[data-label], [data-col-hidden], [data-stack-full], [data-cell]").forEach((cell) => {
    delete cell.dataset.label;
    delete cell.dataset.cell;
    delete cell.dataset.colHidden;
    delete cell.dataset.stackFull;
  });
}
