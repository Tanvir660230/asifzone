"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { StockMovement } from "@clothing-brand/shared";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { toast } from "@/components/ui/toast";
import { useCapability } from "@/hooks/use-capability";
import { ApiError, getErrorMessage } from "@/lib/api-client";
import * as inventoryApi from "@/lib/api/inventory";
import { formatStoreDateTime } from "@/lib/format";

/** Entries a person made by hand — the ones a correction may undo (docs/STOCK_HUB.md §10). */
const REVERSIBLE = new Set<StockMovement["reason"]>(["RESTOCK", "ADJUSTMENT", "IMPORT", "DAMAGED", "LOST"]);

/** The correction state of a stock entry, and — for the owner — "Undo this entry", which takes the same units back out (or
 * in) and moves the books back by exactly what the entry booked. */
export function ReverseMovement({ movement }: { movement: StockMovement }) {
  const canReverse = useCapability("inventory.approve");
  const [open, setOpen] = useState(false);
  if (movement.reversesMovementId) return <Badge variant="info" title={movement.reverses ? `Undoes the ${formatStoreDateTime(movement.reverses.createdAt)} entry (${movement.reverses.change > 0 ? "+" : ""}${movement.reverses.change})` : undefined}>Correction</Badge>;
  if (movement.reversedBy) return <Badge variant="neutral" title={`Undone ${formatStoreDateTime(movement.reversedBy.createdAt)}`}>Undone</Badge>;
  if (!canReverse || !REVERSIBLE.has(movement.reason)) return null;
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)} data-testid="reverse-movement">Undo</Button>
      {open && <ReverseModal movement={movement} onClose={() => setOpen(false)} />}
    </>
  );
}

function ReverseModal({ movement, onClose }: { movement: StockMovement; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const [countedSince, setCountedSince] = useState<string | null>(null);
  const [confirmCount, setConfirmCount] = useState(false);
  const [tried, setTried] = useState(false);
  const ok = reason.trim().length >= 3 && (!countedSince || confirmCount);
  const save = useMutation({
    mutationFn: () => inventoryApi.reverseStockMovement(movement.id, { reason: reason.trim(), ...(countedSince ? { acknowledgeLaterCount: true } : {}) }),
    onSuccess: (r) => {
      toast.success(`Entry undone — ${movement.variant?.sku ?? "item"} now ${r.stock}`);
      void qc.invalidateQueries({ queryKey: ["stock-movements"] });
      void qc.invalidateQueries({ queryKey: ["stock-hub"] });
      onClose();
    },
    onError: (e) => {
      const details = e instanceof ApiError ? (e.details as { code?: string } | undefined) : undefined;
      if (details?.code === "COUNTED_SINCE") { setCountedSince(getErrorMessage(e, "")); return; }
      toast.error(getErrorMessage(e, "The entry couldn't be undone"));
    },
  });
  const sign = movement.change > 0 ? "+" : "";
  return (
    <Modal
      open
      onClose={onClose}
      title="Undo this stock entry"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={() => { setTried(true); if (ok) save.mutate(); }} data-testid="reverse-save">Undo the entry</Button></>}
    >
      <div className="space-y-4">
        <p className="text-sm text-ink-700">
          {movement.variant?.product.name} <span className="text-ink-500">({movement.variant?.sku})</span>: <span className="font-medium tabular-nums">{sign}{movement.change}</span> {movement.reason.toLowerCase()} on {formatStoreDateTime(movement.createdAt)}.
          {" "}It is taken {movement.change > 0 ? "back out" : "back in"} — the same {Math.abs(movement.change)} units — and the books move back by exactly what this entry booked. The entry stays in the history, marked undone.
        </p>
        <Field htmlFor="reverse-reason" label="Why was it wrong?" required error={tried && reason.trim().length < 3 ? "Say why, in a few words" : undefined}>
          <Input id="reverse-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="e.g. 200 typed instead of 20" data-testid="reverse-reason" />
        </Field>
        {countedSince && (
          <Alert variant="warning" title="Counted again since">
            <p>{countedSince}</p>
            <label className="mt-2 flex min-h-11 items-center gap-2">
              <Checkbox checked={confirmCount} onChange={(e) => setConfirmCount(e.target.checked)} data-testid="reverse-confirm-count" />
              That count didn&apos;t correct this entry — undo it anyway
            </label>
          </Alert>
        )}
      </div>
    </Modal>
  );
}
