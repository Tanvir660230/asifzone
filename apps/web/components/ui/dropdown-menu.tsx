"use client";

import type { RefObject } from "react";
import type { LucideIcon } from "lucide-react";
import { Popover } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface DropdownMenuItem {
  label: string;
  icon?: LucideIcon;
  onClick: () => void;
  destructive?: boolean;
  disabled?: boolean;
}

interface DropdownMenuProps {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  items: DropdownMenuItem[];
  align?: "start" | "end";
}

/** A short list of actions anchored to a trigger (typically a "⋯" icon button) — built on
 * `Popover` so it gets the same positioning/outside-click/Escape behavior for free. Replaces
 * rows of separate icon buttons with a single trigger + menu, per the "context menus instead of
 * icon clutter" requirement. */
export function DropdownMenu({ open, onClose, anchorRef, items, align = "end" }: DropdownMenuProps) {
  return (
    <Popover open={open} onClose={onClose} anchorRef={anchorRef} align={align} className="w-52 p-1.5">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.label}
            disabled={item.disabled}
            onClick={() => {
              item.onClick();
              onClose();
            }}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors duration-150 ease-smooth disabled:pointer-events-none disabled:opacity-40",
              item.destructive ? "text-danger-600 hover:bg-danger-50" : "text-ink-700 hover:bg-ink-50",
            )}
          >
            {Icon && <Icon size={15} className={item.destructive ? "text-danger-500" : "text-ink-400"} />}
            {item.label}
          </button>
        );
      })}
    </Popover>
  );
}
