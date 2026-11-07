"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { BulkReceiveRow } from "@clothing-brand/shared";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { SegmentedControl } from "@/components/ui/tabs";
import { Spinner } from "@/components/ui/spinner";
import { getErrorMessage } from "@/lib/api-client";
import { bulkReceiveParcels } from "@/lib/api/parcel-scans";
import { settleIdempotencyKey } from "@/lib/idempotency";
import { toast } from "@/components/ui/toast";
import { invalidateOrderQueries } from "./order-domain";

type Condition = "GOOD" | "DAMAGED";

/** "These came back": many returned parcels received at once, the customer kept nothing, all in one condition. The
 * preview (the server's own decision, nothing changed) shows which parcels will be received and which are left for a
 * person, and why; confirming receives each through the scanner's receive. */
export function BulkReceiveDialog({ open, orderIds, onClose, onDone }: { open: boolean; orderIds: string[]; onClose: () => void; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [condition, setCondition] = useState<Condition>("GOOD");
  const [rows, setRows] = useState<BulkReceiveRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  // A string key: the caller builds a new array every render, and the preview must not refetch on each one.
  const idsKey = orderIds.join(",");
  useEffect(() => {
    if (!open) return;
    let live = true;
    setRows(null);
    setError(null);
    setDone(false);
    bulkReceiveParcels({ orderIds: idsKey.split(","), condition, dryRun: true })
      .then((r) => live && setRows(r.rows))
      .catch((e) => live && setError(getErrorMessage(e, "Couldn't check these parcels")));
    return () => {
      live = false;
    };
  }, [open, idsKey, condition]);

  const toReceive = rows?.filter((r) => r.action === "RECEIVE") ?? [];
  const units = toReceive.reduce((s, r) => s + r.units, 0);

  async function confirm() {
    setBusy(true);
    try {
      const result = await bulkReceiveParcels({ orderIds: toReceive.map((r) => r.orderId), condition, dryRun: false });
      settleIdempotencyKey("parcel-receive-bulk");
      setRows(result.rows);
      setDone(true);
      const received = result.rows.filter((r) => r.action === "RECEIVED").length;
      const failed = result.rows.filter((r) => r.action === "FAILED").length;
      if (received) toast.success(`${received} parcel${received === 1 ? "" : "s"} received`);
      if (failed) toast.error(`${failed} couldn't be received — see the list`);
      invalidateOrderQueries(queryClient);
      onDone();
    } catch (e) {
      setError(getErrorMessage(e, "Couldn't receive these parcels"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="These parcels came back"
      description="The customer kept nothing. Every unit still out comes back into stock as you choose below."
      footer={
        done ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={confirm} loading={busy} disabled={!toReceive.length} data-testid="bulk-receive-confirm">
              {toReceive.length ? `Receive ${toReceive.length} parcel${toReceive.length === 1 ? "" : "s"}` : "Nothing to receive"}
            </Button>
          </>
        )
      }
    >
      {!done && (
        <SegmentedControl
          aria-label="Condition"
          value={condition}
          onChange={(v) => setCondition(v as Condition)}
          options={[
            { value: "GOOD", label: "Good, back to stock" },
            { value: "DAMAGED", label: "Damaged, written off" },
          ]}
        />
      )}
      {error && (
        <Alert variant="danger" title="Something went wrong" className="mt-3">
          {error}
        </Alert>
      )}
      {!rows && !error && (
        <div className="flex items-center gap-2 py-6 text-sm text-fg-muted">
          <Spinner size={14} /> Checking each parcel…
        </div>
      )}
      {rows && (
        <>
          {!done && (
            <p className="mt-3 text-sm text-fg" data-testid="bulk-receive-summary">
              {toReceive.length ? `${toReceive.length} parcel${toReceive.length === 1 ? "" : "s"}, ${units} unit${units === 1 ? "" : "s"} will be received.` : "None of these can be received in bulk."}
            </p>
          )}
          <ul className="mt-2 max-h-80 divide-y divide-line-subtle overflow-y-auto rounded-xl border border-line-subtle" aria-label="Parcels">
            {rows.map((r) => (
              <li key={r.orderId} className="flex items-start justify-between gap-3 px-3 py-2 text-sm" data-testid="bulk-receive-row">
                <div className="min-w-0">
                  <p className="font-medium text-fg">{r.orderNumber ?? r.orderId}</p>
                  {r.reason && <p className="text-xs text-fg-muted">{r.reason}</p>}
                </div>
                <Badge variant={r.action === "RECEIVED" || r.action === "RECEIVE" ? "success" : r.action === "FAILED" ? "danger" : "neutral"} className="shrink-0">
                  {r.action === "RECEIVE" ? `${r.units} unit${r.units === 1 ? "" : "s"}` : r.action === "RECEIVED" ? "Received" : r.action === "FAILED" ? "Not received" : "Left for you"}
                </Badge>
              </li>
            ))}
          </ul>
        </>
      )}
    </Modal>
  );
}
