"use client";

import { useEffect, useState } from "react";
import type { DataTableColumn } from "./types";

/** Per-admin, per-table column visibility — a browser convenience (localStorage), never required for the table to work. */
export function useColumnVisibility<Row>(columns: DataTableColumn<Row>[], storageKey?: string) {
  const defaults = () => new Set(columns.filter((c) => c.defaultHidden).map((c) => c.id));
  const [hidden, setHidden] = useState<Set<string>>(defaults);

  useEffect(() => {
    if (!storageKey) return;
    try {
      const raw = localStorage.getItem(`datatable:${storageKey}:hidden`);
      if (raw) setHidden(new Set((JSON.parse(raw) as string[]).filter((id) => columns.some((c) => c.id === id))));
    } catch {
      // Private mode / blocked storage: keep the defaults.
    }
    // Columns are declared once per table; only the storage key identifies a saved preference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  function toggle(id: string) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      if (storageKey) {
        try {
          localStorage.setItem(`datatable:${storageKey}:hidden`, JSON.stringify([...next]));
        } catch {
          // Not persisted — still applied for this visit.
        }
      }
      return next;
    });
  }

  const visible = columns.filter((c, i) => i === 0 || c.hideable === false || !hidden.has(c.id));
  return { hidden, visible, toggle };
}
