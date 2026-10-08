"use client";

import { useEffect, useState, type ReactNode } from "react";
import { AlertCircle, ArrowLeft, ArrowRight, Check, CloudOff, Eye, EyeOff, History, Loader2 } from "lucide-react";
import type { Category, Product, WizardStepId } from "@clothing-brand/shared";
import { ProductStatusPanel } from "@/components/admin/product-status-panel";
import { ProductHistory } from "@/components/admin/product-history";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Stepper } from "./stepper";
import { PreviewPane } from "./preview-pane";
import { STEP_DESCRIPTION } from "./step-meta";
import { useProductBuilder, type ProductBuilderController, type SaveState } from "./use-product-builder";
import { BasicsStep, MediaStep, PricingStep, VariantsStep, CareStep, SizeGuideStep, ContentStep, SeoStep, PreviewStep, ReviewStep, PublishStep } from "./steps";

interface ProductBuilderProps {
  categories: Category[];
  /** Present in edit mode; its absence puts the builder in "new" mode, which creates the product as a draft. */
  initial?: Product;
}

/** The one product editor — create and edit, every product type. Behavior lives in `useProductBuilder`; this
 * component only lays it out. */
export function ProductBuilder({ categories, initial }: ProductBuilderProps) {
  const b = useProductBuilder({ categories, initial });
  const [showPreview, setShowPreview] = useState(true);
  const [previewDecided, setPreviewDecided] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  // The preview sits beside the form on wide screens; below that it would push the form down, so it starts closed.
  useEffect(() => {
    if (!window.matchMedia("(min-width: 1280px)").matches) setShowPreview(false);
    setPreviewDecided(true);
  }, []);

  const lastStep = b.steps[b.steps.length - 1]!;

  return (
    <div className="space-y-5">
      {b.mode === "edit" && (
        <ProductStatusPanel
          status={b.initial!.status}
          result={b.completeness}
          busy={b.busy}
          onAction={(status) => void b.actions.saveWithStatus(status)}
          onFix={b.actions.fix}
        />
      )}

      {b.recovery && (
        <div data-testid="resume-draft">
          <Alert
            variant="info"
            title="You have an unfinished product"
            action={
              <span className="flex gap-2">
                <Button type="button" size="sm" onClick={b.resumeDraft}>
                  Continue
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={b.discardDraft}>
                  Start fresh
                </Button>
              </span>
            }
          >
            Continue where you left off on &ldquo;{b.recovery.values.name || "a new product"}&rdquo;?
          </Alert>
        </div>
      )}

      <div className={cn("grid grid-cols-1 items-start gap-6", showPreview && "xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] 2xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]")}>
        <div className="min-w-0 space-y-4">
          {/* Sticky glass header: where you are, whether it's saved, and the step track. */}
          <div className="glass-panel space-y-3 rounded-2xl p-3 sm:p-4 lg:sticky lg:top-chrome lg:z-sticky">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-1">
              <div className="min-w-0">
                <p className="truncate font-display text-lg tracking-tight text-fg">{b.productName || "New product"}</p>
                <SaveIndicator controller={b} lastStepLabel={lastStep.label} />
              </div>
              <div className="flex items-center gap-1.5">
                {b.mode === "edit" && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setShowHistory((v) => !v)} aria-expanded={showHistory}>
                    <History size={15} aria-hidden="true" /> History
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowPreview((v) => !v)}
                  aria-pressed={showPreview}
                  aria-label={showPreview ? "Hide preview" : "Show preview"}
                  title={showPreview ? "Hide preview" : "Show preview"}
                  data-testid="toggle-preview"
                  data-ready={previewDecided || undefined}
                >
                  {showPreview ? <EyeOff size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}
                  <span className="hidden sm:inline">Preview</span>
                </Button>
              </div>
            </div>
            <Stepper steps={b.steps} onSelect={b.goTo} />
          </div>

          <StepCard controller={b} />

          {b.mode === "edit" && showHistory && (
            <section className="rounded-2xl border border-line-subtle bg-surface p-5 shadow-sm sm:p-6" aria-labelledby="builder-history">
              <h2 id="builder-history" className="font-display text-lg tracking-tight text-fg">
                History
              </h2>
              <p className="mb-4 text-sm text-fg-muted">Who changed what on this product, and when.</p>
              <ProductHistory productId={b.initial!.id} />
            </section>
          )}
        </div>

        {showPreview && (
          <aside className="min-w-0 xl:sticky xl:top-chrome" aria-label="Live preview">
            <PreviewPane product={b.previewProduct} height={720} />
          </aside>
        )}
      </div>
    </div>
  );
}

/** Saved / saving / failed — always visible, so the admin never wonders whether an edit reached the store. The
 * element's text is exactly the state word (tests and screen readers read it as such). */
function SaveIndicator({ controller: b, lastStepLabel }: { controller: ProductBuilderController; lastStepLabel: string }) {
  if (b.mode === "new") {
    return (
      <p className="flex items-center gap-1.5 text-xs text-fg-muted" data-testid="wizard-autosave-status" aria-live="polite">
        Not saved yet — the draft is created when you finish {lastStepLabel}.
      </p>
    );
  }
  const view: Record<SaveState, { icon: ReactNode; text: string; className: string }> = {
    idle: { icon: <Check size={13} aria-hidden="true" />, text: "Autosave on", className: "text-fg-muted" },
    pending: { icon: <span className="h-1.5 w-1.5 rounded-full bg-warning-500" aria-hidden="true" />, text: "Unsaved changes", className: "text-fg-muted" },
    saving: { icon: <Loader2 size={13} className="animate-spin" aria-hidden="true" />, text: "Saving…", className: "text-fg-muted" },
    saved: { icon: <Check size={13} aria-hidden="true" />, text: "Saved", className: "text-success-700" },
    error: {
      icon: <CloudOff size={13} aria-hidden="true" />,
      text: `Couldn't save — ${b.saveError ?? "the server didn't accept the change"}. It retries on your next change.`,
      className: "text-danger-600",
    },
  };
  const v = view[b.saveState];
  return (
    <p
      className={cn("flex items-center gap-1.5 text-xs", v.className)}
      aria-live="polite"
      title={b.lastSavedAt ? `Last saved at ${b.lastSavedAt.toLocaleTimeString()} · Ctrl/⌘+S saves now` : "Ctrl/⌘+S saves now"}
    >
      {v.icon}
      <span data-testid="wizard-autosave-status">{v.text}</span>
    </p>
  );
}

function renderStep(id: WizardStepId, b: ProductBuilderController) {
  const { state, actions, categories } = b;
  switch (id) {
    case "basics":
      return <BasicsStep state={state} categories={categories} />;
    case "media":
      return <MediaStep state={state} />;
    case "pricing":
      return <PricingStep state={state} />;
    case "variants":
      return <VariantsStep state={state} />;
    case "care":
      return <CareStep state={state} />;
    case "sizeGuide":
      return <SizeGuideStep state={state} />;
    case "content":
      return <ContentStep state={state} relationNames={b.relationNames} onRelationNames={b.addRelationNames} />;
    case "seo":
      return <SeoStep state={state} actions={actions} />;
    case "preview":
      return <PreviewStep state={state} />;
    case "review":
      return <ReviewStep state={state} actions={actions} />;
    case "publish":
      return <PublishStep state={state} actions={actions} />;
    default:
      return null;
  }
}

/** One step: what it's for, its content, and the Back / Continue controls (sticky, so they're always in reach). */
function StepCard({ controller: b }: { controller: ProductBuilderController }) {
  const step = b.currentStep;
  const total = b.steps.length;
  const isLast = b.currentIndex === total - 1;
  const titleId = `builder-step-${step.id}`;

  return (
    <section className="rounded-2xl border border-line-subtle bg-surface shadow-sm" aria-labelledby={titleId} key={step.id}>
      <header className="border-b border-line-subtle px-5 py-5 sm:px-7">
        <p className="text-caption font-semibold uppercase text-fg-subtle">
          Step {b.currentIndex + 1} of {total}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
          <h2 id={titleId} className="font-display text-display-sm text-fg">
            {step.label}
          </h2>
          {step.issues > 0 && b.mode === "edit" && (
            <Badge variant="warning" dot>
              {step.issues} required {step.issues === 1 ? "item" : "items"} missing
            </Badge>
          )}
        </div>
        <p className="mt-1.5 max-w-2xl text-sm text-fg-muted">{STEP_DESCRIPTION[step.id]}</p>
      </header>

      <div className="space-y-8 px-5 py-6 animate-fade-in sm:px-7">
        {b.error && (
          <Alert variant="danger" title="This can't be saved yet">
            {b.error}
          </Alert>
        )}
        {renderStep(step.id, b)}
      </div>

      <footer className="glass sticky bottom-0 z-raised flex flex-wrap items-center justify-between gap-3 rounded-b-2xl border-t border-line-subtle px-5 py-3.5 sm:px-7">
        <Button type="button" variant="outline" onClick={b.back} disabled={b.currentIndex === 0 || b.creating}>
          <ArrowLeft size={15} aria-hidden="true" /> Back
        </Button>
        <div className="flex items-center gap-3">
          {b.isCreateStep && <span className="hidden text-xs text-fg-muted sm:inline">Continuing creates the draft</span>}
          {step.status === "error" && (
            <span className="flex items-center gap-1 text-xs text-danger-600">
              <AlertCircle size={13} aria-hidden="true" /> Check the highlighted fields
            </span>
          )}
          {(!isLast || b.isCreateStep) && (
            <Button type="button" onClick={b.next} loading={b.creating}>
              Continue <ArrowRight size={15} aria-hidden="true" />
            </Button>
          )}
        </div>
      </footer>
    </section>
  );
}

