"use client";

import { create } from "zustand";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, X, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface ToastItem {
  id: string;
  message: string;
  variant: "success" | "error";
}

interface ToastState {
  toasts: ToastItem[];
  push: (message: string, variant: ToastItem["variant"]) => void;
  dismiss: (id: string) => void;
}

const useToastStore = create<ToastState>()((set) => ({
  toasts: [],
  push: (message, variant) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    set((state) => ({ toasts: [...state.toasts, { id, message, variant }] }));
    setTimeout(() => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })), 4000);
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));

export const toast = {
  success: (message: string) => useToastStore.getState().push(message, "success"),
  error: (message: string) => useToastStore.getState().push(message, "error"),
};

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[200] flex w-full max-w-sm flex-col gap-2">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: 16, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.15 } }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            className={cn(
              "glass pointer-events-auto flex items-start gap-3 rounded-xl border px-4 py-3 shadow-floatLg",
              t.variant === "success" ? "border-success-100" : "border-danger-100",
            )}
            role="status"
          >
            {t.variant === "success" ? (
              <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-success-600" />
            ) : (
              <XCircle size={18} className="mt-0.5 shrink-0 text-danger-600" />
            )}
            <p className="flex-1 text-sm text-ink-800">{t.message}</p>
            <button onClick={() => dismiss(t.id)} aria-label="Dismiss" className="shrink-0 text-ink-400 hover:text-ink-700">
              <X size={16} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
