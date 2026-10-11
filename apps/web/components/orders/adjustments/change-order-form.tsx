"use client";

import { useState } from "react";
import { ArrowLeft, ChevronDown } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AddressEditor } from "./address-editor";
import { LineEditor } from "./line-editor";
import { ModificationSummary, modificationOutcome } from "./modification-summary";
import type { ModificationFlow } from "./use-modification-flow";

const CONFIRM_LABEL = {
  pay: "Confirm and continue to payment",
  collect: "Confirm change",
  credit: "Confirm change",
  refund: "Confirm change",
  none: "Confirm change",
} as const;

/**
 * The change-order steps, shared by the customer page and the staff dialog: 1) edit what's in the order and where it
 * goes, 2) review the server's summary, 3) confirm. Errors show the server's own reason; a re-priced change is shown
 * again before anything is applied.
 */
export function ChangeOrderForm({
  flow,
  audience,
  paymentMethod,
  onCancel,
  idPrefix,
  /** Staff-only extras rendered on the review step (e.g. "collect the difference later"). */
  reviewExtras,
}: {
  flow: ModificationFlow;
  audience: "customer" | "staff";
  paymentMethod: string;
  onCancel: () => void;
  idPrefix: string;
  reviewExtras?: React.ReactNode;
}) {
  const [showAddress, setShowAddress] = useState(flow.addressChanged);
  const errorBox = flow.error && (
    <Alert variant={flow.error.kind === "stock" || flow.error.kind === "changed" ? "warning" : "danger"} title={flow.error.kind === "not-editable" ? "This order can't be changed now" : "Couldn't continue"}>
      {flow.error.message}
    </Alert>
  );

  if (flow.step === "review" && flow.preview) {
    const outcome = modificationOutcome(flow.preview);
    return (
      <div className="space-y-4" data-testid="change-order-review">
        {flow.repriced && (
          <Alert variant="warning" title="Prices were updated">
            Something changed while you were reviewing (a price, stock or the order itself). Here is the up-to-date summary — please check it and confirm again.
          </Alert>
        )}
        <ModificationSummary preview={flow.preview} audience={audience} paymentMethod={paymentMethod} />
        {reviewExtras}
        {errorBox}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <Button variant="outline" className="min-h-11" onClick={flow.backToEdit} disabled={flow.applying}>
            <ArrowLeft size={14} aria-hidden="true" /> Back to editing
          </Button>
          <Button className="min-h-11" loading={flow.applying} disabled={flow.error?.kind === "not-editable"} onClick={flow.confirm} data-testid="confirm-change">
            {CONFIRM_LABEL[outcome.kind]}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="change-order-edit">
      <section aria-labelledby={`${idPrefix}-items`}>
        <h3 id={`${idPrefix}-items`} className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">
          Items
        </h3>
        <LineEditor lines={flow.lines} onChange={flow.setLines} />
      </section>
      <section aria-labelledby={`${idPrefix}-address`}>
        <button
          type="button"
          id={`${idPrefix}-address`}
          aria-expanded={showAddress}
          onClick={() => setShowAddress(!showAddress)}
          className="flex min-h-11 w-full items-center justify-between gap-2 text-left text-xs font-semibold uppercase tracking-wide text-ink-500"
        >
          Delivery details{flow.addressChanged ? " · changed" : ""}
          <ChevronDown size={16} className={cn("transition-transform", showAddress && "rotate-180")} aria-hidden="true" />
        </button>
        {showAddress && <AddressEditor idPrefix={idPrefix} value={flow.address} onChange={flow.setAddress} />}
      </section>
      {errorBox}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        <Button variant="outline" className="min-h-11" onClick={onCancel}>
          Cancel
        </Button>
        <Button className="min-h-11" disabled={!flow.dirty || flow.empty} loading={flow.previewing} onClick={flow.review} data-testid="review-change">
          Review changes
        </Button>
      </div>
      {!flow.dirty && <p className="text-right text-xs text-ink-500">Make a change to see the updated total.</p>}
    </div>
  );
}
