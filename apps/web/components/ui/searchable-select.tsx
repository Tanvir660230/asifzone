"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { fuzzyFilter } from "@/lib/fuzzy-search";

/** Tallest the list gets (the old max-h-60), the least it shrinks to, its gap from the field, and what fixed bars cover. */
const LIST_MAX = 240;
const MIN_LIST = 120;
const GAP = 6;
const PHONE_BOTTOM_BARS = 144;

interface SearchableSelectProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly string[];
  placeholder?: string;
  autoComplete?: string;
  disabled?: boolean;
  className?: string;
  emptyText?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}

// A native <select> only matches on exact prefix (browser "type-ahead"), so a typo means the
// shopper can't find their district at all. This combobox lets them type to filter — tolerating
// misspellings via fuzzyFilter — while still behaving like a dropdown (click to open, pick from a
// list, keyboard nav) rather than a free-text field.
export function SearchableSelect({
  id,
  value,
  onChange,
  options,
  placeholder = "Search...",
  autoComplete,
  disabled,
  className,
  emptyText = "No matches",
  ...aria
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const optionRefs = useRef<Array<HTMLLIElement | null>>([]);
  /** Where the open list goes: below the field unless there's no room there (end of a sheet, phone keyboard, tab bar). */
  const [placement, setPlacement] = useState<{ up: boolean; maxHeight: number }>({ up: false, maxHeight: LIST_MAX });

  const filtered = open ? fuzzyFilter(query, options, (option) => option) : options;

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    setHighlighted(0);
  }, [query, open]);

  // Keep the highlighted option visible by scrolling the list only — scrollIntoView would also move the page or sheet.
  useEffect(() => {
    const list = listRef.current;
    const item = optionRefs.current[highlighted];
    if (!list || !item) return;
    if (item.offsetTop < list.scrollTop) list.scrollTop = item.offsetTop;
    else if (item.offsetTop + item.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = item.offsetTop + item.offsetHeight - list.clientHeight;
  }, [highlighted, open]);

  // An open list must be on screen. On a phone the field is often near the bottom — under the tab bar, a sticky action
  // bar or the keyboard — so the list used to open out of sight ("the thana list doesn't show"). Bring the field up, then
  // open the list on whichever side has room inside every scrolling box around it, and follow scrolls and the keyboard.
  useEffect(() => {
    if (!open) return;
    const el = containerRef.current;
    if (!el) return;
    const narrow = window.matchMedia("(max-width: 767px)").matches;
    if (narrow) el.scrollIntoView({ block: "start", behavior: "smooth" });
    const place = () => {
      const r = el.getBoundingClientRect();
      const vv = window.visualViewport;
      let top = vv ? vv.offsetTop : 0;
      let bottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
      // Fixed bars along the bottom of a phone screen (tab bar, sticky "Call & confirm") cover roughly the last 9rem.
      if (narrow) bottom -= PHONE_BOTTOM_BARS;
      for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
          const box = node.getBoundingClientRect();
          top = Math.max(top, box.top);
          bottom = Math.min(bottom, box.bottom);
        }
      }
      const below = bottom - r.bottom - GAP;
      const above = r.top - top - GAP;
      const up = below < Math.min(LIST_MAX, 160) && above > below;
      setPlacement({ up, maxHeight: Math.max(MIN_LIST, Math.min(LIST_MAX, up ? above : below)) });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    window.visualViewport?.addEventListener("resize", place);
    window.visualViewport?.addEventListener("scroll", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("scroll", place);
    };
  }, [open]);

  function selectOption(option: string) {
    onChange(option);
    setQuery("");
    setOpen(false);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter") {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const option = filtered[highlighted];
      if (option) selectOption(option);
    } else if (e.key === "Escape") {
      // An open list is the top layer: claim the Escape so a modal around this field stays open (lib/layer-stack.ts
      // skips handled events). With the list closed, Escape falls through and closes the modal as before.
      if (open) e.preventDefault();
      setOpen(false);
      setQuery("");
    }
  }

  return (
    <div ref={containerRef} className="relative scroll-mt-24">
      <div className="relative">
        <input
          id={id}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={id ? `${id}-listbox` : undefined}
          aria-autocomplete="list"
          autoComplete={autoComplete}
          disabled={disabled}
          className={cn(
            "ui-control pr-9",
            className,
          )}
          placeholder={placeholder}
          value={open ? query : value}
          onFocus={(e) => {
            setOpen(true);
            setQuery("");
            e.target.select();
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={handleKeyDown}
          {...aria}
        />
        <ChevronDown
          className={cn(
            "pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle transition-transform duration-base ease-smooth",
            open && "rotate-180",
          )}
        />
      </div>
      {open && (
        <ul
          ref={listRef}
          id={id ? `${id}-listbox` : undefined}
          role="listbox"
          style={{ maxHeight: placement.maxHeight }}
          className={cn("ui-floating absolute z-overlay w-full overflow-auto overscroll-contain p-1 animate-pop-in", placement.up ? "bottom-full mb-1.5" : "mt-1.5")}
        >
          {filtered.length === 0 && <li className="px-3 py-2 text-sm text-ink-400">{emptyText}</li>}
          {filtered.map((option, index) => (
            <li
              key={option}
              ref={(el) => {
                optionRefs.current[index] = el;
              }}
              role="option"
              aria-selected={option === value}
              onMouseDown={(e) => {
                e.preventDefault();
                selectOption(option);
              }}
              onMouseEnter={() => setHighlighted(index)}
              className={cn(
                "flex cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-sm text-fg",
                index === highlighted && "bg-ink-900/[0.05]",
              )}
            >
              {option}
              {option === value && <Check className="h-4 w-4 text-fg" aria-hidden="true" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
