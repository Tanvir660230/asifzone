"use client";

import { useState } from "react";
import { AlertTriangle, Check, ChevronDown, Minus } from "lucide-react";
import type { CompletenessCheck, CompletenessCheckKey, CompletenessResult, ProductStatus } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { ProductStatusBadge } from "@/components/admin/product-status-badge";
import { cn } from "@/lib/utils";

/** Where each check gets fixed. "images" isn't a form tab — images are managed in the card above the form. */
export type FixTarget = "basic" | "pricing" | "variants" | "care" | "seo" | "images";
const FIX_TARGET: Record<CompletenessCheckKey, FixTarget> = {
  basics: "basic",
  pricing: "pricing",
  variants: "variants",
  images: "images",
  attributes: "basic",
  inventory: "pricing",
  description: "basic",
  seo: "seo",
  sizeGuide: "basic",
  material: "care",
  care: "care",
};

interface ProductStatusPanelProps {
  /** null while creating — the product doesn't exist yet. */
  status: ProductStatus | null;
  result: CompletenessResult;
  createLabel: string;
  busy: boolean;
  onAction: (status?: ProductStatus) => void;
  onFix: (target: FixTarget) => void;
}

function CheckRow({ check, onFix }: { check: CompletenessCheck; onFix: (t: FixTarget) => void }) {
  const Icon = check.status === "ok" ? Check : check.status === "na" ? Minus : AlertTriangle;
  return (
    <li className="flex items-start gap-2 text-sm">
      <Icon
        size={15}
        className={cn("mt-0.5 shrink-0", check.status === "ok" && "text-success-600", check.status === "missing" && (check.required ? "text-danger-600" : "text-brass-600"), check.status === "na" && "text-ink-300")}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <span className={cn(check.status === "ok" ? "text-ink-700" : "text-ink-900")}>
          {check.label}
          {check.status === "missing" && check.required && <span className="ml-1.5 text-[11px] font-medium uppercase tracking-wide text-danger-600">required</span>}
        </span>
        {check.status === "missing" && (
          <p className="text-xs text-ink-500">
            {check.detail ?? check.hint}{" "}
            <button type="button" className="underline hover:text-ink-900" onClick={() => onFix(FIX_TARGET[check.key])}>
              {FIX_TARGET[check.key] === "images" ? "Go to images" : "Fix"}
            </button>
          </p>
        )}
      </div>
    </li>
  );
}

/** Status, completeness meter and the workflow buttons. The buttons that would move the product to READY / PUBLISHED
 * are disabled — with the reason shown — while a required check is missing; the server enforces the same rule. */
export function ProductStatusPanel({ status, result, createLabel, busy, onAction, onFix }: ProductStatusPanelProps) {
  const [open, setOpen] = useState(false);
  const blocked = result.blockers.length > 0;
  const missingOptional = result.checks.filter((c) => c.status === "missing" && !c.required).length;
  const tone = result.score >= 90 ? "bg-success-500" : result.score >= 60 ? "bg-brass-500" : "bg-danger-500";
  const blockedHint = blocked ? `Missing: ${result.blockers.map((b) => b.label).join(", ")}` : undefined;

  return (
    <div className="rounded-xl border border-ink-100 bg-cream-50 p-4" data-testid="product-status-panel">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {status ? <ProductStatusBadge status={status} /> : <span className="rounded-full bg-ink-100 px-2.5 py-0.5 text-xs font-medium text-ink-600">New product</span>}
          <div className="w-36 sm:w-48">
            <div className="flex items-baseline justify-between text-xs text-ink-500">
              <span>Completeness</span>
              <span className="font-medium text-ink-900" data-testid="completeness-score">{result.score}%</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-100" role="progressbar" aria-valuenow={result.score} aria-valuemin={0} aria-valuemax={100} aria-label="Product completeness">
              <div className={cn("h-full rounded-full transition-all duration-300", tone)} style={{ width: `${result.score}%` }} />
            </div>
          </div>
          <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 text-xs text-ink-500 hover:text-ink-900" aria-expanded={open}>
            {blocked ? `${result.blockers.length} required missing` : missingOptional ? `${missingOptional} suggestion${missingOptional === 1 ? "" : "s"}` : "All set"}
            <ChevronDown size={14} className={cn("transition-transform", open && "rotate-180")} />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {status === null && (
            <Button type="button" variant="brass" disabled={busy} onClick={() => onAction()}>
              {busy ? "Saving…" : createLabel}
            </Button>
          )}
          {status === "DRAFT" && (
            <>
              <Button type="button" variant="outline" disabled={busy} onClick={() => onAction()}>
                Save draft
              </Button>
              <Button type="button" variant="outline" disabled={busy || blocked} title={blockedHint} onClick={() => onAction("READY")}>
                Mark ready
              </Button>
              <Button type="button" variant="brass" disabled={busy || blocked} title={blockedHint} onClick={() => onAction("PUBLISHED")}>
                Publish
              </Button>
            </>
          )}
          {status === "READY" && (
            <>
              <Button type="button" variant="outline" disabled={busy} onClick={() => onAction()}>
                Save
              </Button>
              <Button type="button" variant="outline" disabled={busy} onClick={() => onAction("DRAFT")}>
                Back to draft
              </Button>
              <Button type="button" variant="brass" disabled={busy || blocked} title={blockedHint} onClick={() => onAction("PUBLISHED")}>
                Publish
              </Button>
            </>
          )}
          {status === "PUBLISHED" && (
            <>
              <Button type="button" variant="outline" disabled={busy} onClick={() => onAction("UNPUBLISHED")}>
                Unpublish
              </Button>
              <Button type="button" variant="brass" disabled={busy} onClick={() => onAction()}>
                {busy ? "Saving…" : "Save changes"}
              </Button>
            </>
          )}
          {status === "UNPUBLISHED" && (
            <>
              <Button type="button" variant="outline" disabled={busy} onClick={() => onAction()}>
                Save
              </Button>
              <Button type="button" variant="brass" disabled={busy || blocked} title={blockedHint} onClick={() => onAction("PUBLISHED")}>
                Publish
              </Button>
            </>
          )}
        </div>
      </div>

      {blocked && status !== "PUBLISHED" && (
        <p className="mt-3 rounded-md bg-danger-50 px-3 py-2 text-xs text-danger-700" role="status">
          Before this can go {status === "READY" ? "live" : "ready or live"}: {result.blockers.map((b) => b.detail ?? b.label).join(" · ")}
        </p>
      )}

      {open && (
        <ul className="mt-4 grid grid-cols-1 gap-x-8 gap-y-2 border-t border-ink-100 pt-4 sm:grid-cols-2">
          {result.checks.map((c) => (
            <CheckRow key={c.key} check={c} onFix={onFix} />
          ))}
        </ul>
      )}
    </div>
  );
}
