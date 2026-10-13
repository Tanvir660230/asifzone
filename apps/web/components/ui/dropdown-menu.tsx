"use client";

import { type RefObject, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { LucideIcon } from "lucide-react";
import { Popover } from "@/components/ui/popover";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { useMediaQuery } from "@/hooks/use-media-query";
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
  /** Accessible name of the menu, e.g. "Actions for ORD-123". */
  label?: string;
}

/** A short list of actions anchored to a trigger (typically a "⋯" icon button) — built on
 * `Popover` so it gets the same positioning/outside-click/Escape behavior for free. Replaces
 * rows of separate icon buttons with a single trigger + menu, per the "context menus instead of
 * icon clutter" requirement. On phones it is an iOS action sheet instead: thumb-sized rows from the bottom edge and a
 * separate Cancel. */
export function DropdownMenu({ open, onClose, anchorRef, items, align = "end", label }: DropdownMenuProps) {
  const phone = useMediaQuery("(max-width: 767px)");
  if (phone) return <ActionSheet open={open} onClose={onClose} items={items} label={label} />;
  return (
    <Popover open={open} onClose={onClose} anchorRef={anchorRef} align={align} role="menu" aria-label={label} className="w-52 p-1.5">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              item.onClick();
              onClose();
            }}
            className={cn("ui-menu-item", item.destructive && "text-danger-600 hover:bg-danger-50 focus-visible:bg-danger-50")}
          >
            {Icon && <Icon size={15} className={item.destructive ? "text-danger-500" : "text-fg-subtle"} aria-hidden="true" />}
            {item.label}
          </button>
        );
      })}
    </Popover>
  );
}

function ActionSheet({ open, onClose, items, label }: { open: boolean; onClose: () => void; items: DropdownMenuItem[]; label?: string }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const panelRef = useFocusTrap<HTMLDivElement>({ active: open, onEscape: onClose });
  if (!open || !mounted) return null;

  return createPortal(
    <div className="ui-overlay fixed inset-0 z-overlay flex animate-fade-in items-end" onClick={onClose}>
      <div
        ref={panelRef}
        role="menu"
        aria-label={label}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="w-full animate-slide-in-up space-y-2 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] outline-none"
      >
        <div className="max-h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-6rem)] overflow-y-auto overscroll-contain rounded-[14px] bg-surface/95 backdrop-blur-xl">
          {label && <p className="border-b border-ink-900/[0.08] px-4 py-3 text-center text-[13px] text-fg-muted">{label}</p>}
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  item.onClick();
                  onClose();
                }}
                className={cn(
                  "flex h-14 w-full items-center justify-center gap-2.5 border-b border-ink-900/[0.08] text-[19px] tracking-[-0.02em] last:border-b-0 active:bg-ink-900/[0.06] disabled:opacity-40",
                  item.destructive ? "text-danger-600" : "text-accent",
                )}
              >
                {Icon && <Icon size={19} aria-hidden="true" />}
                {item.label}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="h-14 w-full rounded-[14px] bg-surface text-[19px] font-semibold tracking-[-0.02em] text-accent active:bg-surface-muted"
        >
          Cancel
        </button>
      </div>
    </div>,
    document.body,
  );
}
