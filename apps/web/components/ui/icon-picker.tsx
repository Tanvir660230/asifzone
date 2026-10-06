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
      // An open list is the top layer: claim the Escape so a modal around this field stays open (lib/layer-stack.ts
      // skips handled events). With the list closed, Escape falls through and closes the modal as before.
      if (open) e.preventDefault();
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
        className="ui-control flex items-center gap-2 text-left"
      >
        <SelectedIcon size={16} className="shrink-0 text-ink-600" aria-hidden="true" />
        <span className="flex-1 truncate">{value || "Choose an icon…"}</span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-fg-subtle transition-transform duration-base ease-smooth", open && "rotate-180")} />
      </button>

      {open && (
        <div className="ui-floating absolute z-overlay mt-1.5 w-64 animate-pop-in">
          <div className="border-b border-line-subtle p-2">
            <input
              autoFocus
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search icons…"
              className="ui-control h-8 px-2"
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
                    index === highlighted && "bg-ink-900/[0.05]",
                    name === value && "bg-ink-900/[0.08] text-fg",
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
