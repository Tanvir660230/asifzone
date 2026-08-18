"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { DateRange } from "@/components/admin/date-range-picker";

const STORAGE_KEY = "admin-bi-date-range";

function defaultRange(): DateRange {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 29);
  from.setHours(0, 0, 0, 0);
  to.setHours(23, 59, 59, 999);
  return { from, to };
}

const BiDateRangeContext = createContext<{ range: DateRange; setRange: (range: DateRange) => void } | null>(null);

/** Single date range shared across all 15 BI tabs (Google-Analytics-style — one range, not
 * per-section), persisted to localStorage the same way sidebar.tsx persists collapse state:
 * start from a deterministic default so SSR and first client render match, then correct from
 * storage after mount. */
export function BiDateRangeProvider({ children }: { children: ReactNode }) {
  const [range, setRangeState] = useState<DateRange>(defaultRange);

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as { from: string; to: string };
      setRangeState({ from: new Date(parsed.from), to: new Date(parsed.to) });
    } catch {
      // Malformed/stale storage value — keep the default range.
    }
  }, []);

  function setRange(next: DateRange) {
    setRangeState(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ from: next.from.toISOString(), to: next.to.toISOString() }));
  }

  return <BiDateRangeContext.Provider value={{ range, setRange }}>{children}</BiDateRangeContext.Provider>;
}

export function useBiDateRange() {
  const ctx = useContext(BiDateRangeContext);
  if (!ctx) throw new Error("useBiDateRange must be used within BiDateRangeProvider");
  return ctx;
}
