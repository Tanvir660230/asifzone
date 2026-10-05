"use client";

import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { Search, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface SearchInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> {
  value: string;
  onChange: (value: string) => void;
  /** Called by the clear button instead of onChange("") when provided. */
  onClear?: () => void;
  /** Shown at the right edge while the field is empty (e.g. a keyboard-shortcut hint). */
  emptyAdornment?: ReactNode;
  /** Class for the wrapper (width/layout); `className` styles the input itself. */
  wrapperClassName?: string;
}

/** Search field for lists and filters: leading icon, clear button, shared control styling. */
export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(
  ({ value, onChange, onClear, emptyAdornment, wrapperClassName, className, "aria-label": ariaLabel, placeholder, ...props }, ref) => (
    <div className={cn("relative", wrapperClassName)}>
      <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle" aria-hidden="true" />
      <input
        ref={ref}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel ?? (typeof placeholder === "string" ? placeholder : "Search")}
        className={cn("ui-control pl-9 pr-8 [&::-webkit-search-cancel-button]:hidden", className)}
        {...props}
      />
      {value ? (
        <button
          type="button"
          onClick={() => (onClear ? onClear() : onChange(""))}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full text-ink-300 transition-colors duration-fast hover:text-ink-600"
          aria-label="Clear search"
        >
          <XCircle size={15} />
        </button>
      ) : (
        emptyAdornment && <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2">{emptyAdornment}</span>
      )}
    </div>
  ),
);
SearchInput.displayName = "SearchInput";
