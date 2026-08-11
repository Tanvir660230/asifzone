"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { fuzzyFilter } from "@/lib/fuzzy-search";

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
  const optionRefs = useRef<Array<HTMLLIElement | null>>([]);

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

  useEffect(() => {
    optionRefs.current[highlighted]?.scrollIntoView({ block: "nearest" });
  }, [highlighted]);

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
      setOpen(false);
      setQuery("");
    }
  }

  return (
    <div ref={containerRef} className="relative">
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
            "h-10 w-full rounded-lg border border-ink-200 bg-cream-50 px-3 pr-9 text-sm text-ink-900 transition-all duration-200 ease-smooth placeholder:text-ink-400 focus:border-brass-400 focus:shadow-glow disabled:opacity-50",
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
            "pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400 transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </div>
      {open && (
        <ul
          id={id ? `${id}-listbox` : undefined}
          role="listbox"
          className="animate-fade-in absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-ink-200 bg-white py-1 shadow-lg"
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
                "flex cursor-pointer items-center justify-between px-3 py-2 text-sm text-ink-900",
                index === highlighted && "bg-cream-200",
              )}
            >
              {option}
              {option === value && <Check className="h-4 w-4 text-brass-500" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
