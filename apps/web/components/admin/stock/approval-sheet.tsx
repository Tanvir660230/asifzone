"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { getErrorMessage } from "@/lib/api-client";
import { stockKeys } from "@/lib/api/stock";
import { decideStockApproval, listStockApprovals, smartKeys } from "@/lib/api/stock-smart";
import { formatBookDate, formatPrice } from "@/lib/format";
import { num } from "./stock-shared";

const REASON: Record<string, string> = { DAMAGED: "Damaged", LOST: "Lost", SAMPLE: "Given as samples", COUNT_FIX: "Miscounted before" };

/**
 * A count loss waiting for the owner (docs/STOCK_HUB.md §7): what was counted, what the books said, the reason and the
 * value. Approving takes the difference out of stock as it was counted; rejecting leaves the stock and keeps the count.
 */
export function ApprovalSheet({ id, canDecide, onClose }: { id: string; canDecide: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const q = useQuery({ queryKey: smartKeys.approvals(), queryFn: () => listStockApprovals("PENDING") });
  const a = q.data?.approvals.find((x) => x.id === id);
  const decide = useMutation({
    mutationFn: (decision: "APPROVE" | "REJECT") => decideStockApproval(id, { decision, note: note.trim() || null }),
    onSuccess: (r) => {
      toast.success(r.status === "APPROVED" ? "Loss approved — stock updated" : "Loss rejected — stock unchanged");
      void qc.invalidateQueries({ queryKey: stockKeys.all });
      onClose();
    },
    onError: (e) => toast.error(getErrorMessage(e, "The decision couldn't be saved")),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="Count loss to approve"
      description="The stock hasn't changed yet. It changes only if you approve."
      widthClassName="max-w-md"
      footer={canDecide && a ? (
        <>
          <Button variant="outline" onClick={() => decide.mutate("REJECT")} disabled={decide.isPending} data-testid="approval-reject">Reject</Button>
          <Button onClick={() => decide.mutate("APPROVE")} loading={decide.isPending && decide.variables === "APPROVE"} data-testid="approval-approve">Approve loss</Button>
        </>
      ) : <Button variant="outline" onClick={onClose}>Close</Button>}
    >
      {q.isLoading ? (
        <div className="space-y-2"><Skeleton className="h-5 w-2/3" /><Skeleton className="h-16 w-full" /></div>
      ) : q.isError ? (
        <p className="text-sm text-fg-muted">{getErrorMessage(q.error, "This count couldn't be loaded.")} <button type="button" onClick={() => q.refetch()} className="font-medium text-fg underline underline-offset-4">Try again</button></p>
      ) : !a ? (
        <p className="text-sm text-fg-muted">This count has already been decided.</p>
      ) : (
        <div className="space-y-4" data-testid="approval-sheet">
          <p className="text-[15px] font-semibold text-fg">{a.name}</p>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-fg-muted">Books said</dt><dd className="text-right tabular-nums text-fg">{num(a.expected)}</dd>
            <dt className="text-fg-muted">Counted</dt><dd className="text-right tabular-nums text-fg">{num(a.counted)}</dd>
            <dt className="text-fg-muted">Short</dt><dd className="text-right font-semibold tabular-nums text-danger-700">{num(-a.difference)}</dd>
            <dt className="text-fg-muted">Reason</dt><dd className="text-right text-fg">{REASON[a.reason] ?? a.reason}</dd>
            {a.value !== null && <><dt className="text-fg-muted">Value</dt><dd className="text-right tabular-nums text-fg">{formatPrice(a.value)}</dd></>}
            <dt className="text-fg-muted">Counted by</dt><dd className="text-right text-fg">{a.requestedBy ?? "—"}, {formatBookDate(a.countedOn)}</dd>
          </dl>
          {a.note && <p className="rounded-lg bg-surface-muted px-3 py-2 text-sm text-fg">“{a.note}”</p>}
          {canDecide ? (
            <Field htmlFor="approval-note" label="Note" hint="Optional — kept with your decision.">
              <Textarea id="approval-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
            </Field>
          ) : (
            <p className="text-sm text-fg-muted">Waiting for the owner to decide.</p>
          )}
        </div>
      )}
    </Modal>
  );
}
