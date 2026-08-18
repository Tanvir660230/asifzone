"use client";

import { useRef, useState } from "react";
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";
import { Popover } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface DateRange {
  from: Date;
  to: Date;
}

interface DateRangePickerProps {
  value: DateRange;
  onChange: (range: DateRange) => void;
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
}
function startOfYear(d: Date): Date {
  return new Date(d.getFullYear(), 0, 1);
}
function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function formatShort(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const PRESETS: { label: string; range: () => DateRange }[] = [
  { label: "Today", range: () => ({ from: startOfDay(new Date()), to: endOfDay(new Date()) }) },
  { label: "Last 7 days", range: () => ({ from: startOfDay(addDays(new Date(), -6)), to: endOfDay(new Date()) }) },
  { label: "Last 30 days", range: () => ({ from: startOfDay(addDays(new Date(), -29)), to: endOfDay(new Date()) }) },
  { label: "This Month", range: () => ({ from: startOfMonth(new Date()), to: endOfDay(new Date()) }) },
  {
    label: "Last Month",
    range: () => {
      const lastMonth = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1);
      return { from: startOfMonth(lastMonth), to: endOfMonth(lastMonth) };
    },
  },
  { label: "This Year", range: () => ({ from: startOfYear(new Date()), to: endOfDay(new Date()) }) },
  { label: "Last 12 Months", range: () => ({ from: startOfDay(addDays(new Date(), -365)), to: endOfDay(new Date()) }) },
];

function buildMonthGrid(year: number, month: number): (Date | null)[] {
  const startDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < startDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

function MonthCalendar({
  year,
  month,
  draftFrom,
  draftTo,
  hoverDate,
  onHoverDate,
  onSelectDate,
}: {
  year: number;
  month: number;
  draftFrom: Date | null;
  draftTo: Date | null;
  hoverDate: Date | null;
  onHoverDate: (d: Date | null) => void;
  onSelectDate: (d: Date) => void;
}) {
  const cells = buildMonthGrid(year, month);
  const previewEnd = draftTo ?? hoverDate;
  const rangeStart = draftFrom && previewEnd ? (draftFrom <= previewEnd ? draftFrom : previewEnd) : null;
  const rangeEnd = draftFrom && previewEnd ? (draftFrom <= previewEnd ? previewEnd : draftFrom) : null;

  return (
    <div className="w-[228px]">
      <p className="mb-2 text-center text-xs font-semibold text-ink-700">
        {new Date(year, month, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" })}
      </p>
      <div className="grid grid-cols-7 text-center text-[11px] text-ink-400">
        {WEEKDAY_LABELS.map((label, i) => (
          <div key={i}>{label}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-1">
        {cells.map((date, i) => {
          if (!date) return <div key={i} />;
          const isEndpoint = (draftFrom && sameDay(date, draftFrom)) || (previewEnd && sameDay(date, previewEnd));
          const inRange = rangeStart && rangeEnd && date > rangeStart && date < rangeEnd;
          return (
            <button
              key={i}
              type="button"
              onMouseEnter={() => onHoverDate(date)}
              onClick={() => onSelectDate(date)}
              className={cn(
                "mx-auto flex h-7 w-7 items-center justify-center rounded-full text-xs transition-colors duration-100 ease-smooth",
                isEndpoint
                  ? "bg-ink-900 font-semibold text-cream-50"
                  : inRange
                    ? "bg-ink-100 text-ink-900"
                    : "text-ink-600 hover:bg-ink-100",
              )}
            >
              {date.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Google-Analytics-style range trigger: a pill showing the active range, opening a popover with
 * quick presets on the left and a two-month click-click range calendar under "Custom range." Built
 * on the existing Popover primitive (components/ui/popover.tsx) — no new date library. */
export function DateRangePicker({ value, onChange }: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const [showCustom, setShowCustom] = useState(false);
  const [draftFrom, setDraftFrom] = useState<Date | null>(null);
  const [draftTo, setDraftTo] = useState<Date | null>(null);
  const [hoverDate, setHoverDate] = useState<Date | null>(null);
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(value.to));
  const anchorRef = useRef<HTMLButtonElement>(null);

  function openPicker() {
    setShowCustom(false);
    setDraftFrom(value.from);
    setDraftTo(value.to);
    setViewMonth(startOfMonth(value.to));
    setOpen(true);
  }

  function closePicker() {
    setOpen(false);
    setShowCustom(false);
    setHoverDate(null);
  }

  function applyPreset(range: DateRange) {
    onChange(range);
    closePicker();
  }

  function handleSelectDate(date: Date) {
    if (!draftFrom || draftTo) {
      setDraftFrom(date);
      setDraftTo(null);
      return;
    }
    if (date < draftFrom) {
      setDraftTo(draftFrom);
      setDraftFrom(date);
    } else {
      setDraftTo(date);
    }
  }

  function applyCustom() {
    if (!draftFrom) return;
    onChange({ from: startOfDay(draftFrom), to: endOfDay(draftTo ?? draftFrom) });
    closePicker();
  }

  const rightMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1);

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => (open ? closePicker() : openPicker())}
        className="inline-flex shrink-0 items-center gap-2 self-start rounded-full border border-ink-100 bg-ink-50/60 px-3.5 py-1.5 text-xs font-semibold text-ink-700 transition-all duration-200 ease-smooth hover:text-ink-900"
      >
        <Calendar size={14} />
        {formatShort(value.from)} – {formatShort(value.to)}
      </button>

      <Popover open={open} onClose={closePicker} anchorRef={anchorRef} align="end">
        <div className="flex">
          <div className="w-40 shrink-0 space-y-0.5 border-r border-ink-100 p-2">
            {PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => applyPreset(preset.range())}
                className="block w-full rounded-lg px-3 py-2 text-left text-xs font-medium text-ink-600 transition-colors duration-150 ease-smooth hover:bg-ink-100 hover:text-ink-900"
              >
                {preset.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setShowCustom(true)}
              className={cn(
                "block w-full rounded-lg px-3 py-2 text-left text-xs font-medium transition-colors duration-150 ease-smooth",
                showCustom ? "bg-ink-900 text-cream-50" : "text-ink-600 hover:bg-ink-100 hover:text-ink-900",
              )}
            >
              Custom range
            </button>
          </div>

          {showCustom && (
            <div className="p-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <button
                  type="button"
                  aria-label="Previous month"
                  onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1))}
                  className="rounded-full p-1 text-ink-500 hover:bg-ink-100"
                >
                  <ChevronLeft size={16} />
                </button>
                <p className="text-xs text-ink-500">
                  {draftFrom ? formatShort(draftFrom) : "Start date"} – {draftTo ? formatShort(draftTo) : "End date"}
                </p>
                <button
                  type="button"
                  aria-label="Next month"
                  onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1))}
                  className="rounded-full p-1 text-ink-500 hover:bg-ink-100"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
              <div className="flex gap-4" onMouseLeave={() => setHoverDate(null)}>
                <MonthCalendar
                  year={viewMonth.getFullYear()}
                  month={viewMonth.getMonth()}
                  draftFrom={draftFrom}
                  draftTo={draftTo}
                  hoverDate={hoverDate}
                  onHoverDate={setHoverDate}
                  onSelectDate={handleSelectDate}
                />
                <MonthCalendar
                  year={rightMonth.getFullYear()}
                  month={rightMonth.getMonth()}
                  draftFrom={draftFrom}
                  draftTo={draftTo}
                  hoverDate={hoverDate}
                  onHoverDate={setHoverDate}
                  onSelectDate={handleSelectDate}
                />
              </div>
              <div className="mt-3 flex justify-end gap-2 border-t border-ink-100 pt-3">
                <button
                  type="button"
                  onClick={closePicker}
                  className="rounded-full px-3.5 py-1.5 text-xs font-semibold text-ink-500 hover:text-ink-900"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={applyCustom}
                  disabled={!draftFrom}
                  className="rounded-full bg-ink-900 px-3.5 py-1.5 text-xs font-semibold text-cream-50 disabled:opacity-40"
                >
                  Apply
                </button>
              </div>
            </div>
          )}
        </div>
      </Popover>
    </>
  );
}
