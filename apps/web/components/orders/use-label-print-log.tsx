"use client";

import { useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { ApiError, getErrorMessage } from "@/lib/api-client";
import * as warehouseApi from "@/lib/api/warehouse";

const isReasonRequired = (err: unknown) =>
  err instanceof ApiError && err.status === 400 && (err.details as { code?: string } | undefined)?.code === "REPRINT_REASON_REQUIRED";

/**
 * Records a courier-label print in the print log (docs/WAREHOUSE_OPERATIONS.md §3) after the labels go to the printer.
 * The paper comes first — the print is never held back by the log. A reprint (some of these labels printed before) asks
 * why, since two copies of a label the rider scans can send a parcel twice; the answer is recorded with the run.
 */
export function useLabelPrintLog(): { logPrint: (orderIds: string[], copies: number) => void; dialog: ReactNode } {
  const pending = useRef<{ clientRunId: string; orderIds: string[]; copies: number } | null>(null);
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  async function send(reasonText?: string) {
    const run = pending.current;
    if (!run) return;
    try {
      await warehouseApi.recordPrintRun({ kind: "COURIER_LABEL", clientRunId: run.clientRunId, orderIds: run.orderIds, copies: run.copies, reason: reasonText });
      pending.current = null;
      setAsking(false);
      setReason("");
    } catch (err) {
      if (isReasonRequired(err)) setAsking(true);
      else toast.error(getErrorMessage(err, "The labels printed, but the print wasn't recorded"));
    }
  }

  function logPrint(orderIds: string[], copies: number) {
    if (orderIds.length === 0) return;
    pending.current = { clientRunId: warehouseApi.newPrintRunId(), orderIds, copies: Math.min(50, Math.max(1, copies)) };
    void send();
  }

  const dialog = (
    <Modal
      open={asking}
      onClose={() => {
        // Closing without a reason leaves the reprint unrecorded — say so rather than drop it silently.
        setAsking(false);
        toast.info("Reprint not recorded — no reason given");
        pending.current = null;
      }}
      title="Why reprint these labels?"
      description="Some of these labels were printed before. A second copy of a label can send a parcel twice, so the reason is kept with the print."
      widthClassName="max-w-md"
      footer={
        <Button
          size="sm"
          disabled={reason.trim().length < 3}
          loading={saving}
          onClick={async () => {
            setSaving(true);
            await send(reason.trim());
            setSaving(false);
          }}
        >
          Record reprint
        </Button>
      }
    >
      <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={300} placeholder="e.g. First label tore, printer jammed, wrong size" aria-label="Reason for the reprint" />
    </Modal>
  );

  return { logPrint, dialog };
}
