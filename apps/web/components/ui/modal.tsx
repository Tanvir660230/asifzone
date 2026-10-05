"use client";

import { type ReactNode, useId } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { IconButton } from "./icon-button";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** One line under the title explaining what the dialog is for. */
  description?: ReactNode;
  children: ReactNode;
  /** Action row pinned under the content (Cancel / Save). */
  footer?: ReactNode;
  widthClassName?: string;
}

/** Centered dialog: focus-trapped, Escape closes, scroll-locked, labelled by its title. */
export function Modal({ open, onClose, title, description, children, footer, widthClassName = "max-w-2xl" }: ModalProps) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useFocusTrap<HTMLDivElement>({ active: open, onEscape: onClose });

  if (!open) return null;

  return (
    // No backdrop-click-to-close, unlike Drawer — Modal content is almost always an unsaved form,
    // and a stray click just outside the panel shouldn't discard it.
    <div className="ui-overlay fixed inset-0 z-overlay flex items-start justify-center overflow-y-auto p-4 pt-16 animate-fade-in">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={cn(
          "w-full animate-modal-in rounded-2xl border border-white/70 bg-surface shadow-glass-lg ring-1 ring-ink-900/[0.04]",
          widthClassName,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line-subtle px-6 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="font-display text-lg tracking-tight text-fg">
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className="mt-0.5 text-sm text-fg-muted">
                {description}
              </p>
            )}
          </div>
          <IconButton aria-label="Close" size="sm" onClick={onClose} className="-mr-1.5 mt-0.5">
            <X size={18} />
          </IconButton>
        </div>
        <div className="px-6 py-5">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line-subtle px-6 py-4">{footer}</div>}
      </div>
    </div>
  );
}
