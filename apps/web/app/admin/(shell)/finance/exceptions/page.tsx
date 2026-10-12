"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { HScrollShadow } from "@/components/ui/h-scroll-shadow";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Table, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { EmptyState } from "@/components/admin/empty-state";
import { ModuleTabs } from "@/components/admin/module-tabs";
import { PageHeader } from "@/components/admin/page-header";
import { useCapabilities } from "@/hooks/use-capability";
import { getErrorMessage } from "@/lib/api-client";
import * as financeApi from "@/lib/api/finance";
import type { FinanceException } from "@/lib/api/finance";
import { formatPrice } from "@/lib/format";

const KIND_LABEL: Record<string, string> = {
  MISSING_COST: "Missing cost",
  ORDER_TOTAL_MISMATCH: "Order totals don't add up",
  UNVALUED_STOCK_RECEIPT: "Stock received, no value",
  UNVALUED_STOCK_WRITE_OFF: "Stock removed, no value",
  UNSUPPORTED_CREDIT_ENTRY: "Store credit with no meaning",
  UNMATCHED_SETTLEMENT_LINE: "Settlement line, no order",
  ENGINE_MISMATCH: "Differs from the dashboard engine",
};
const ESTIMABLE = new Set(["MISSING_COST", "UNVALUED_STOCK_WRITE_OFF"]);

/** Finance exceptions (docs/FINANCE_PHASE_3.md §6): what the books won't guess about. A missing cost is acknowledged (it
 * stays missing) or — only under the APPROVED_ESTIMATES policy — resolved with an approved estimate, labelled ESTIMATED. */
export default function FinanceExceptionsPage() {
  const { can, ready } = useCapabilities();
  const queryClient = useQueryClient();
  const allowed = can("finance.view");
  const [status, setStatus] = useState("OPEN");
  const [kind, setKind] = useState("");
  const list = useQuery({ queryKey: [...financeApi.financeKeys.all, "exceptions", status, kind], queryFn: () => financeApi.listExceptions({ status: status || undefined, kind: kind || undefined, pageSize: 200 }), enabled: allowed });
  const business = useQuery({ queryKey: [...financeApi.financeKeys.all, "business"], queryFn: financeApi.getBusiness, enabled: allowed });
  const [acting, setActing] = useState<{ e: FinanceException; mode: "ack" | "estimate" } | null>(null);
  const [note, setNote] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const refresh = () => void queryClient.invalidateQueries({ queryKey: financeApi.financeKeys.all });

  const act = useMutation({
    mutationFn: async () => {
      if (!acting) return;
      if (acting.mode === "ack") await financeApi.acknowledgeException(acting.e.id, note.trim());
      else await financeApi.approveEstimate(acting.e.id, Number(unitCost), note.trim());
    },
    onSuccess: () => {
      refresh();
      toast.success(acting?.mode === "ack" ? "Acknowledged — it stays missing; no cost is booked" : "Estimate approved and posted (labelled ESTIMATED)");
      setActing(null);
    },
    onError: (err) => toast.error(getErrorMessage(err, "Couldn't resolve the exception")),
  });
  const policy = useMutation({
    mutationFn: (next: "KNOWN_ONLY" | "APPROVED_ESTIMATES") => financeApi.setCostPolicy(next, next === "APPROVED_ESTIMATES" ? "Owner allows approved estimates" : "Owner books known costs only"),
    onSuccess: () => { refresh(); toast.success("Cost policy changed"); },
    onError: (err) => toast.error(getErrorMessage(err, "Couldn't change the policy")),
  });

  if (ready && !allowed) {
    return (
      <div>
        <ModuleTabs />
        <EmptyState icon={AlertTriangle} title="Finance is limited to finance roles" />
      </div>
    );
  }
  const estimates = business.data?.costPolicy === "APPROVED_ESTIMATES";
  return (
    <div className="space-y-6">
      <ModuleTabs />
      <PageHeader title="Missing costs & exceptions" description="Accounting problems the books won't guess about — each names its source record. Missing costs are never invented." />
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <p className="text-sm text-ink-700">
          Cost policy: <span className="font-semibold">{estimates ? "approved estimates allowed (labelled ESTIMATED)" : "known costs only"}</span>
        </p>
        {can("finance.configure") && (
          <Button size="sm" variant="outline" loading={policy.isPending} onClick={() => policy.mutate(estimates ? "KNOWN_ONLY" : "APPROVED_ESTIMATES")}>
            {estimates ? "Book known costs only" : "Allow approved estimates"}
          </Button>
        )}
      </Card>
      <div className="flex flex-wrap gap-3">
        <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-44">
          <option value="OPEN">Open</option>
          <option value="ACKNOWLEDGED">Acknowledged</option>
          <option value="RESOLVED">Resolved</option>
          <option value="">All</option>
        </Select>
        <Select aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value)} className="w-64">
          <option value="">Every kind</option>
          {Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </Select>
      </div>
      <Card className="overflow-hidden p-0">
        <HScrollShadow>
          <Table>
            <TableHead>
              <tr>
                <TableHeaderCell>Kind</TableHeaderCell>
                <TableHeaderCell>What</TableHeaderCell>
                <TableHeaderCell>Order</TableHeaderCell>
                <TableHeaderCell align="right">Amount</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell />
              </tr>
            </TableHead>
            <tbody>
              {list.data?.exceptions.map((e) => (
                <TableRow key={e.id} data-testid="exception-row">
                  <TableCell><Badge variant={e.kind === "MISSING_COST" ? "warning" : "neutral"}>{KIND_LABEL[e.kind] ?? e.kind}</Badge></TableCell>
                  <TableCell className="max-w-md">{e.title}{e.resolutionNote && <span className="block text-xs text-ink-500">{e.resolutionNote}</span>}</TableCell>
                  <TableCell>{e.orderNumber ?? "—"}</TableCell>
                  <TableCell align="right" className="tabular-nums">{e.amount === null ? "—" : formatPrice(e.amount)}</TableCell>
                  <TableCell><Badge variant={e.status === "OPEN" ? "warning" : "success"}>{e.status.toLowerCase()}</Badge></TableCell>
                  <TableCell align="right">
                    {e.status !== "RESOLVED" && (
                      <span className="flex justify-end gap-1">
                        {e.status === "OPEN" && can("finance.reconcile") && <Button size="sm" variant="ghost" onClick={() => { setNote(""); setActing({ e, mode: "ack" }); }}>Acknowledge</Button>}
                        {ESTIMABLE.has(e.kind) && can("finance.post") && (
                          <Button size="sm" variant="outline" disabled={!estimates} title={estimates ? undefined : "The cost policy books known costs only"} onClick={() => { setNote(""); setUnitCost(String((e.details as { suggestedUnitCost?: number }).suggestedUnitCost ? ((e.details as { suggestedUnitCost: number }).suggestedUnitCost / 100) : "")); setActing({ e, mode: "estimate" }); }}>
                            Approve estimate
                          </Button>
                        )}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </tbody>
          </Table>
        </HScrollShadow>
        {list.data?.exceptions.length === 0 && <EmptyState icon={AlertTriangle} title="No exceptions here" />}
      </Card>

      {acting && (
        <Modal
          open
          onClose={() => setActing(null)}
          title={acting.mode === "ack" ? "Acknowledge" : "Approve an estimated cost"}
          description={acting.e.title}
          widthClassName="max-w-lg"
          footer={
            <>
              <Button variant="outline" onClick={() => setActing(null)}>Cancel</Button>
              <Button loading={act.isPending} disabled={note.trim().length < 3 || (acting.mode === "estimate" && !(Number(unitCost) > 0))} onClick={() => act.mutate()} data-testid="confirm-exception">
                {acting.mode === "ack" ? "Acknowledge" : "Approve and post"}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            {acting.mode === "estimate" && (
              <>
                <Alert variant="warning" title="An estimate, not a recorded cost">It is booked labelled ESTIMATED and reported apart from the dashboard&apos;s cost. The suggestion is the catalog&apos;s current cost price.</Alert>
                <Field htmlFor="ex-unit" label="Estimated cost per unit" required>
                  <Input id="ex-unit" inputMode="decimal" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} />
                </Field>
              </>
            )}
            <Field htmlFor="ex-note" label={acting.mode === "ack" ? "Why it stays as it is" : "Where the estimate comes from"} required>
              <Textarea id="ex-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
            </Field>
          </div>
        </Modal>
      )}
    </div>
  );
}
