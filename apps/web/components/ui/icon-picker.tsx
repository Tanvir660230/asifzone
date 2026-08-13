"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { fuzzyFilter } from "@/lib/fuzzy-search";
import { HOMEPAGE_ICON_NAMES, resolveHomepageIcon } from "@/lib/homepage-icons";

interface IconPickerProps {
  id?: string;
  value: string;
  onChange: (name: string) => void;
}

/** Same open/close/outside-click/keyboard-nav shape as SearchableSelect, but renders the resolved
 * icon (not just its name) both on the trigger and in the option list — a raw text/name select
 * left admins guessing what e.g. "PackageCheck" looks like on the storefront. */
export function IconPicker({ id, value, onChange }: IconPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const filtered = fuzzyFilter(query, HOMEPAGE_ICON_NAMES, (name) => name);
  const SelectedIcon = resolveHomepageIcon(value);

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

  function selectOption(name: string) {
    onChange(name);
    setQuery("");
    setOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
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
      const name = filtered[highlighted];
      if (name) selectOption(name);
    } else if (e.key === "Escape") {
      setOpen(false);
      setQuery("");
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        id={id}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-controls={id ? `${id}-listbox` : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={handleKeyDown}
        className="flex h-10 w-full items-center gap-2 rounded-lg border border-ink-200 bg-cream-50 px-3 text-left text-sm text-ink-900 transition-all duration-200 ease-smooth focus:border-brass-400 focus:shadow-glow"
      >
        <SelectedIcon size={16} className="shrink-0 text-brass-500" />
        <span className="flex-1 truncate">{value || "Choose an icon…"}</span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-ink-400 transition-transform duration-200", open && "rotate-180")} />
      </button>

      {open && (
        <div className="animate-fade-in absolute z-20 mt-1 w-64 rounded-lg border border-ink-200 bg-white shadow-lg">
          <div className="border-b border-ink-100 p-2">
            <input
              autoFocus
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search icons…"
              className="h-8 w-full rounded-md border border-ink-200 px-2 text-sm text-ink-900 focus:border-brass-400 focus:outline-none"
            />
          </div>
          <div id={id ? `${id}-listbox` : undefined} role="listbox" className="grid max-h-56 grid-cols-4 gap-1 overflow-y-auto p-2">
            {filtered.length === 0 && <p className="col-span-4 px-2 py-4 text-center text-xs text-ink-400">No matches</p>}
            {filtered.map((name, index) => {
              const Icon = resolveHomepageIcon(name);
              return (
                <button
                  key={name}
                  ref={(el) => {
                    optionRefs.current[index] = el;
                  }}
                  type="button"
                  role="option"
                  aria-selected={name === value}
                  title={name}
                  onClick={() => selectOption(name)}
                  onMouseEnter={() => setHighlighted(index)}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-md p-2 text-ink-600 transition-colors",
                    index === highlighted && "bg-cream-200",
                    name === value && "bg-brass-100 text-brass-700",
                  )}
                >
                  <Icon size={18} />
                  <span className="w-full truncate text-center text-[10px] leading-tight">{name}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
