"use client";

import { type ReactNode, useId } from "react";
import { X } from "lucide-react";
import { useFocusTrap } from "@/hooks/use-focus-trap";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  widthClassName?: string;
}

export function Modal({ open, onClose, title, children, widthClassName = "max-w-2xl" }: ModalProps) {
  const titleId = useId();
  const panelRef = useFocusTrap<HTMLDivElement>({ active: open, onEscape: onClose });

  if (!open) return null;

  return (
    // No backdrop-click-to-close here, unlike Drawer — Modal's content is almost always an
    // unsaved form (product/coupon/category/etc.), and a stray click just outside the panel
    // shouldn't be able to discard it. Drawer's content is read-mostly detail views, where that
    // same click is a low-cost dismissal instead.
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink-950/40 p-4 pt-16 backdrop-blur-sm animate-fade-in">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`w-full ${widthClassName} animate-modal-in rounded-2xl bg-cream-50 shadow-floatLg`}
      >
        <div className="flex items-center justify-between border-b border-ink-100 px-6 py-4">
          <h2 id={titleId} className="font-display text-lg text-ink-900">
            {title}
          </h2>
          <button
            onClick={onClose}
            className="rounded-full p-1 text-ink-400 transition-colors duration-150 ease-smooth hover:bg-ink-100 hover:text-ink-900"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}
