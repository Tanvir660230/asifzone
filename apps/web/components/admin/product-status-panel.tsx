"use client";

import { useState } from "react";
import { AlertTriangle, Check, ChevronDown, Minus } from "lucide-react";
import type { CompletenessCheck, CompletenessCheckKey, CompletenessResult, ProductStatus } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { ProgressRing } from "@/components/ui/progress-ring";
import { ProductStatusBadge } from "@/components/admin/product-status-badge";
import { cn } from "@/lib/utils";

interface ProductStatusPanelProps {
  status: ProductStatus;
  /** The shared completeness engine's result — this panel only displays it. */
  result: CompletenessResult;
  busy: boolean;
  onAction: (status?: ProductStatus) => void;
  /** Go to where a check is fixed (the builder maps the check to a step). */
  onFix: (key: CompletenessCheckKey) => void;
}

function CheckRow({ check, onFix }: { check: CompletenessCheck; onFix: (key: CompletenessCheckKey) => void }) {
  const Icon = check.status === "ok" ? Check : check.status === "na" ? Minus : AlertTriangle;
  return (
    <li className="flex items-start gap-2.5 text-sm">
      <Icon
        size={15}
        className={cn(
          "mt-0.5 shrink-0",
          check.status === "ok" && "text-success-600",
          check.status === "missing" && (check.required ? "text-danger-600" : "text-warning-600"),
          check.status === "na" && "text-ink-300",
        )}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <span className={cn(check.status === "ok" ? "text-ink-600" : "text-fg")}>
          {check.label}
          {check.status === "missing" && check.required && (
            <span className="ml-1.5 text-caption font-semibold uppercase text-danger-600">required</span>
          )}
        </span>
        {check.status === "missing" && (
          <p className="text-xs text-fg-muted">
            {check.detail ?? check.hint}{" "}
            <button type="button" className="font-medium text-fg underline underline-offset-2" onClick={() => onFix(check.key)}>
              Fix
            </button>
          </p>
        )}
      </div>
    </li>
  );
}

/** Status, completeness and the publishing workflow. Buttons that would move the product to READY / PUBLISHED are
 * disabled — with the reason shown — while a required check is missing; the server enforces the same rule. */
export function ProductStatusPanel({ status, result, busy, onAction, onFix }: ProductStatusPanelProps) {
  const [open, setOpen] = useState(false);
  const blocked = result.blockers.length > 0;
  const missingOptional = result.checks.filter((c) => c.status === "missing" && !c.required).length;
  const blockedHint = blocked ? `Missing: ${result.blockers.map((b) => b.label).join(", ")}` : undefined;
  const summary = blocked
    ? `${result.blockers.length} required ${result.blockers.length === 1 ? "item" : "items"} missing`
    : missingOptional
      ? `${missingOptional} optional suggestion${missingOptional === 1 ? "" : "s"}`
      : "Everything is complete";

  return (
    <section className="rounded-2xl border border-line-subtle bg-surface p-4 shadow-sm sm:p-5" data-testid="product-status-panel" aria-label="Status and publishing">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3.5">
          <ProgressRing value={result.score} tone={blocked ? "threshold" : "accent"} label="Product completeness" size={48}>
            <span data-testid="completeness-score">{result.score}%</span>
          </ProgressRing>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <ProductStatusBadge status={status} />
              <span className="text-xs text-fg-muted">Completeness</span>
            </div>
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              className="mt-1 flex items-center gap-1 text-sm font-medium text-fg hover:underline"
              aria-expanded={open}
            >
              {summary}
              <ChevronDown size={14} className={cn("transition-transform duration-base ease-smooth", open && "rotate-180")} />
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {status === "DRAFT" && (
            <>
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => onAction()}>
                Save draft
              </Button>
              <Button type="button" variant="outline" size="sm" disabled={busy || blocked} title={blockedHint} onClick={() => onAction("READY")}>
                Mark ready
              </Button>
              <Button type="button" size="sm" disabled={busy || blocked} title={blockedHint} onClick={() => onAction("PUBLISHED")}>
                Publish
              </Button>
            </>
          )}
          {status === "READY" && (
            <>
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => onAction()}>
                Save
              </Button>
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => onAction("DRAFT")}>
                Back to draft
              </Button>
              <Button type="button" size="sm" disabled={busy || blocked} title={blockedHint} onClick={() => onAction("PUBLISHED")}>
                Publish
              </Button>
            </>
          )}
          {status === "PUBLISHED" && (
            <>
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => onAction("UNPUBLISHED")}>
                Unpublish
              </Button>
              <Button type="button" size="sm" loading={busy} onClick={() => onAction()}>
                Save changes
              </Button>
            </>
          )}
          {status === "UNPUBLISHED" && (
            <>
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => onAction()}>
                Save
              </Button>
              <Button type="button" size="sm" disabled={busy || blocked} title={blockedHint} onClick={() => onAction("PUBLISHED")}>
                Publish
              </Button>
            </>
          )}
        </div>
      </div>

      {blocked && status !== "PUBLISHED" && (
        <p className="mt-3 rounded-lg border border-danger-100 bg-danger-50 px-3 py-2 text-xs text-danger-700" role="status">
          Before this can go {status === "READY" ? "live" : "ready or live"}: {result.blockers.map((b) => b.detail ?? b.label).join(" · ")}
        </p>
      )}

      {open && (
        <ul className="mt-4 grid grid-cols-1 gap-x-8 gap-y-2.5 border-t border-line-subtle pt-4 sm:grid-cols-2">
          {result.checks.map((c) => (
            <CheckRow key={c.key} check={c} onFix={onFix} />
          ))}
        </ul>
      )}
    </section>
  );
}
