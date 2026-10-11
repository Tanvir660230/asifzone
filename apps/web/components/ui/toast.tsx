"use client";

import { create } from "zustand";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Info, X, XCircle, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { variants } from "@/lib/motion";
import { IconButton } from "./icon-button";

type ToastVariant = "success" | "error" | "info" | "warning";

interface ToastItem {
  id: string;
  message: string;
  variant: ToastVariant;
}

interface ToastState {
  toasts: ToastItem[];
  push: (message: string, variant: ToastVariant) => void;
  dismiss: (id: string) => void;
}

/** Errors stay a little longer — they usually need reading, not just noticing. */
const DURATION_MS: Record<ToastVariant, number> = { success: 4000, info: 4000, warning: 6000, error: 6000 };

const useToastStore = create<ToastState>()((set) => ({
  toasts: [],
  push: (message, variant) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    set((state) => ({ toasts: [...state.toasts, { id, message, variant }] }));
    setTimeout(() => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })), DURATION_MS[variant]);
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));

/** Imperative feedback for the action that was just taken. For persistent, contextual messages use
 * <Alert>; for system notifications use the admin notification bell. */
export const toast = {
  success: (message: string) => useToastStore.getState().push(message, "success"),
  error: (message: string) => useToastStore.getState().push(message, "error"),
  info: (message: string) => useToastStore.getState().push(message, "info"),
  warning: (message: string) => useToastStore.getState().push(message, "warning"),
};

const ICON: Record<ToastVariant, { icon: LucideIcon; className: string }> = {
  success: { icon: CheckCircle2, className: "text-success-600" },
  error: { icon: XCircle, className: "text-danger-600" },
  info: { icon: Info, className: "text-info-600" },
  warning: { icon: AlertTriangle, className: "text-warning-600" },
};

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-4 bottom-4 z-toast flex flex-col gap-2 sm:inset-x-auto sm:right-4 sm:w-full sm:max-w-sm"
    >
      <AnimatePresence>
        {toasts.map((t) => {
          const { icon: Icon, className } = ICON[t.variant];
          return (
            <motion.div
              key={t.id}
              layout
              variants={variants.toast}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="glass-panel pointer-events-auto flex items-start gap-3 rounded-xl px-4 py-3"
              role={t.variant === "error" ? "alert" : "status"}
            >
              <Icon size={18} className={cn("mt-0.5 shrink-0", className)} aria-hidden="true" />
              <p className="flex-1 text-sm text-ink-800">{t.message}</p>
              <IconButton size="sm" onClick={() => dismiss(t.id)} aria-label="Dismiss" className="-my-1 -mr-1.5">
                <X size={15} />
              </IconButton>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
