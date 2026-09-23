"use client";

import { Check } from "lucide-react";
import type { WizardStep, WizardStepId } from "@clothing-brand/shared";
import { cn } from "@/lib/utils";

interface ProgressHeaderProps {
  steps: WizardStep[];
  currentStepId: WizardStepId;
  /** A step is "done" once the admin has moved past it at least once — purely a display/navigation
   * aid, not a validity claim (a step can be revisited and still be incomplete). */
  visitedIds: Set<WizardStepId>;
  onSelect: (id: WizardStepId) => void;
  productName?: string;
  percentComplete: number;
}

export function ProgressHeader({ steps, currentStepId, visitedIds, onSelect, productName, percentComplete }: ProgressHeaderProps) {
  const currentIndex = steps.findIndex((s) => s.id === currentStepId);

  return (
    <div className="space-y-3 rounded-xl border border-ink-100 bg-cream-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-ink-900">{productName || "New product"}</p>
          <p className="text-xs text-ink-500">
            Step {currentIndex + 1} of {steps.length} · {percentComplete}% complete
          </p>
        </div>
      </div>

      <ol className="flex flex-wrap items-center gap-x-1 gap-y-2">
        {steps.map((step, i) => {
          const done = visitedIds.has(step.id) && i < currentIndex;
          const current = step.id === currentStepId;
          const reachable = done || current || visitedIds.has(step.id);
          return (
            <li key={step.id} className="flex items-center">
              <button
                type="button"
                disabled={!reachable}
                onClick={() => onSelect(step.id)}
                data-testid={`wizard-step-${step.id}`}
                aria-current={current ? "step" : undefined}
                aria-label={step.label}
                className={cn(
                  "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors duration-150 ease-smooth",
                  current
                    ? "border-ink-900 bg-ink-900 text-cream-50"
                    : done
                      ? "border-success-300 bg-success-50 text-success-800 hover:border-success-400"
                      : reachable
                        ? "border-ink-200 text-ink-600 hover:border-ink-400"
                        : "cursor-not-allowed border-ink-100 text-ink-300",
                )}
              >
                {done ? <Check size={12} /> : <span className="tabular-nums">{i + 1}</span>}
                {step.label}
              </button>
              {i < steps.length - 1 && <span className="mx-1 h-px w-3 bg-ink-200" aria-hidden />}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
