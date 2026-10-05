"use client";

import { useEffect, useRef } from "react";
import { AlertCircle, Check } from "lucide-react";
import type { WizardStepId } from "@clothing-brand/shared";
import { cn } from "@/lib/utils";
import { HScrollShadow } from "@/components/ui/h-scroll-shadow";
import type { BuilderStep } from "./use-product-builder";

interface StepperProps {
  steps: BuilderStep[];
  onSelect: (id: WizardStepId) => void;
}

const STATUS_TEXT: Record<BuilderStep["status"], string> = {
  current: "current step",
  complete: "complete",
  attention: "needs attention",
  error: "has errors",
  upcoming: "not started",
};

/** The builder's step track: one list for every screen size — a scrollable row that keeps the current step in view.
 * Each step says where it stands: done, needs attention (a required publish check it owns is missing), has
 * validation errors, current, or not reached yet. */
export function Stepper({ steps, onSelect }: StepperProps) {
  const listRef = useRef<HTMLOListElement>(null);
  const current = steps.find((s) => s.status === "current")?.id;

  // Keep the current step visible when the row overflows (phones, narrow windows).
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>("[aria-current='step']");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el?.scrollIntoView({ block: "nearest", inline: "center", behavior: reduce ? "auto" : "smooth" });
  }, [current]);

  return (
    <nav aria-label="Product builder steps" className="-mx-1">
      {/* Edge fades show there are more steps off-screen when the row overflows. */}
      <HScrollShadow edgeFrom="from-surface/90" className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <ol ref={listRef} className="flex w-max items-center gap-1 px-1 pb-1">
        {steps.map((step, i) => {
          const isCurrent = step.status === "current";
          return (
            <li key={step.id} className="flex shrink-0 items-center">
              <button
                type="button"
                disabled={!step.reachable}
                onClick={() => onSelect(step.id)}
                data-testid={`wizard-step-${step.id}`}
                data-status={step.status}
                aria-current={isCurrent ? "step" : undefined}
                aria-label={step.label}
                aria-describedby={`step-status-${step.id}`}
                title={!step.reachable ? "Available once you reach it" : undefined}
                className={cn(
                  "group flex items-center gap-2 rounded-full py-1.5 pl-1.5 pr-3 text-xs font-medium transition-[background-color,color,box-shadow] duration-base ease-smooth",
                  isCurrent && "bg-accent text-accent-fg shadow-float",
                  !isCurrent && step.reachable && "text-ink-700 hover:bg-ink-900/[0.05]",
                  !step.reachable && "cursor-not-allowed text-fg-subtle",
                )}
              >
                <span
                  className={cn(
                    "flex h-6 w-6 items-center justify-center rounded-full text-[0.6875rem] tabular-nums ring-1 ring-inset transition-colors duration-base",
                    isCurrent && "bg-accent-fg/15 text-accent-fg ring-accent-fg/25",
                    step.status === "complete" && "bg-success-50 text-success-700 ring-success-200",
                    step.status === "attention" && "bg-warning-50 text-warning-700 ring-warning-200",
                    step.status === "error" && "bg-danger-50 text-danger-600 ring-danger-200",
                    step.status === "upcoming" && "bg-surface text-fg-subtle ring-line",
                  )}
                  aria-hidden="true"
                >
                  {step.status === "complete" ? (
                    <Check size={13} strokeWidth={2.5} />
                  ) : step.status === "attention" || step.status === "error" ? (
                    <AlertCircle size={13} strokeWidth={2.5} />
                  ) : (
                    i + 1
                  )}
                </span>
                <span className="whitespace-nowrap">{step.label}</span>
                <span id={`step-status-${step.id}`} className="sr-only">
                  {STATUS_TEXT[step.status]}
                  {step.issues > 0 && `, ${step.issues} required ${step.issues === 1 ? "item" : "items"} missing`}
                </span>
              </button>
              {i < steps.length - 1 && <span className="mx-0.5 h-px w-3 shrink-0 bg-line" aria-hidden="true" />}
            </li>
          );
        })}
      </ol>
      </HScrollShadow>
    </nav>
  );
}
