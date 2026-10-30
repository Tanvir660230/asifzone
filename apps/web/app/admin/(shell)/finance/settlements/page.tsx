"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Truck, Upload } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
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
import * as booksApi from "@/lib/api/finance-books";
import type { FinancialAccount, Settlement } from "@/lib/api/finance";
import { formatPrice } from "@/lib/format";
import { idempotencyKeyFor } from "@/lib/idempotency";
import { PermissionState } from "@/components/admin/permission-state";
import { todayLocal } from "@/lib/datetime-local";

const STATUS_BADGE = { DRAFT: "warning", POSTED: "success", REVERSED: "neutral" } as const;
const today = () => todayLocal();
type Line = { orderNumber: string; amount: string; fee: string };
const blankLine = (): Line => ({ orderNumber: "", amount: "", fee: "" });

/** Courier and gateway settlements (docs/FINANCE_PHASE_3.md §5): what a courier or gateway paid out against what it
 * collected. Fees are only what the statement says — never invented. A posted settlement is changed by reversal only. */
export default function SettlementsPage() {
  const { can, ready } = useCapabilities();
  const queryClient = useQueryClient();
  const { confirm, dialog } = useConfirmDialog();
  const allowed = can("finance.view");
  const accounts = useQuery({ queryKey: financeApi.financeKeys.accounts(), queryFn: financeApi.listFinancialAccounts, enabled: allowed });
  const list = useQuery({ queryKey: [...financeApi.financeKeys.all, "settlements"], queryFn: () => financeApi.listSettlements({ pageSize: 100 }), enabled: allowed });
  const all = accounts.data?.financialAccounts ?? [];
  const clearing = all.filter((a) => financeApi.CLEARING_KINDS.has(a.kind) && a.isActive);
  const destinations = all.filter((a) => !financeApi.CLEARING_KINDS.has(a.kind) && a.isActive);
  const [positionOf, setPositionOf] = useState("");
  const position = useQuery({ queryKey: [...financeApi.financeKeys.all, "clearing", positionOf], queryFn: () => financeApi.clearingPosition(positionOf), enabled: Boolean(positionOf) });
  const [mode, setMode] = useState<"manual" | "csv" | null>(null);
  const [reversing, setReversing] = useState<Settlement | null>(null);
  const [reason, setReason] = useState("");
  const refresh = () => void queryClient.invalidateQueries({ queryKey: financeApi.financeKeys.all });

  const post = useMutation({
    mutationFn: (id: string) => financeApi.postSettlement(id),
    onSuccess: () => { refresh(); toast.success("Settlement posted"); },
    onError: (err) => toast.error(getErrorMessage(err, "The settlement couldn't be posted")),
  });
  const outside = useMutation({
    mutationFn: (id: string) => booksApi.markOutsideSales(id),
    onSuccess: (s) => { refresh(); toast.success(`${s.outsideSaleLines} parcel(s) counted as sales outside the website — check and post`); },
    onError: (err) => toast.error(getErrorMessage(err, "Couldn't change the draft")),
  });
  const reverse = useMutation({
    mutationFn: () => financeApi.reverseSettlement(reversing!.id, reason.trim()),
    onSuccess: () => { refresh(); setReversing(null); toast.success("Settlement reversed"); },
    onError: (err) => toast.error(getErrorMessage(err, "The settlement couldn't be reversed")),
  });
  const remove = useMutation({
    mutationFn: (id: string) => financeApi.deleteSettlement(id),
    onSuccess: () => { refresh(); toast.success("Draft deleted"); },
    onError: (err) => toast.error(getErrorMessage(err, "The draft couldn't be deleted")),
  });

  if (ready && !allowed) {
    return (
      <div>
        <ModuleTabs />
        <PermissionState icon={Truck} page="this finance page" />
      </div>
    );
  }
  return (
    <div className="space-y-6">
      {dialog}
      <ModuleTabs />
      <PageHeader
        title="Courier & gateway payouts"
        description="Cash on delivery and online payments sit in clearing until the courier or gateway pays out. A settlement moves them to the bank, with the fees the statement shows."
        action={
          can("finance.transact") && (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setMode("csv")}><Upload className="h-4 w-4" /> Import statement</Button>
              <Button size="sm" onClick={() => setMode("manual")} data-testid="new-settlement"><Plus className="h-4 w-4" /> New settlement</Button>
            </div>
          )
        }
      />

      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">Waiting in clearing</h2>
          <Select aria-label="Clearing account" value={positionOf} onChange={(e) => setPositionOf(e.target.value)} className="w-72">
            <option value="">Choose a clearing account…</option>
            {clearing.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
          {position.data && <span className="text-sm text-ink-700" data-testid="clearing-balance">Open: <span className="font-semibold tabular-nums">{formatPrice(position.data.balance)}</span></span>}
        </div>
        {position.data && (
          <>
            {position.data.oversettled.length > 0 && <Alert variant="warning" title="Settled more than collected">{position.data.oversettled.length} order(s) — usually a refund the courier or gateway hasn&apos;t deducted yet.</Alert>}
            <HScrollShadow>
              <Table>
                <TableHead>
                  <tr>
                    <TableHeaderCell>Order</TableHeaderCell>
                    <TableHeaderCell>Status</TableHeaderCell>
                    <TableHeaderCell align="right">Collected</TableHeaderCell>
                    <TableHeaderCell align="right">Settled</TableHeaderCell>
                    <TableHeaderCell align="right">Waiting</TableHeaderCell>
                  </tr>
                </TableHead>
                <tbody>
                  {position.data.openOrders.slice(0, 200).map((o) => (
                    <TableRow key={o.orderId}>
                      <TableCell>{o.orderNumber ?? o.orderId}</TableCell>
                      <TableCell>{o.orderStatus?.toLowerCase().replace(/_/g, " ") ?? "—"}</TableCell>
                      <TableCell align="right" className="tabular-nums">{formatPrice(o.received)}</TableCell>
                      <TableCell align="right" className="tabular-nums">{formatPrice(o.settled)}</TableCell>
                      <TableCell align="right" className="tabular-nums font-medium">{formatPrice(o.open)}</TableCell>
                    </TableRow>
                  ))}
                </tbody>
              </Table>
            </HScrollShadow>
            {position.data.openOrders.length === 0 && <p className="text-sm text-ink-500">Nothing waiting — every collection here has been settled.</p>}
          </>
        )}
      </Card>

      <Card className="overflow-hidden p-0">
        <HScrollShadow>
          <Table>
            <TableHead>
              <tr>
                <TableHeaderCell>Date</TableHeaderCell>
                <TableHeaderCell>Reference</TableHeaderCell>
                <TableHeaderCell>From → to</TableHeaderCell>
                <TableHeaderCell align="right">Gross</TableHeaderCell>
                <TableHeaderCell align="right">Fees</TableHeaderCell>
                <TableHeaderCell align="right">Adjustment</TableHeaderCell>
                <TableHeaderCell align="right">Paid out</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell />
              </tr>
            </TableHead>
            <tbody>
              {list.data?.settlements.map((s) => (
                <TableRow key={s.id} data-testid="settlement-row">
                  <TableCell>{s.settlementDate.slice(0, 10)}</TableCell>
                  <TableCell>
                    {s.reference}
                    <span className="block text-xs text-ink-500">{s.lines.length} line(s){s.unmatchedLines ? ` · ${s.unmatchedLines} unmatched` : ""}{s.outsideSaleLines ? ` · ${s.outsideSaleLines} outside the website` : ""}{s.source === "CSV_IMPORT" ? " · imported" : s.source === "API_IMPORT" ? " · from Steadfast" : ""}</span>
                  </TableCell>
                  <TableCell className="text-sm">{s.clearingAccount.name} → {s.destinationAccount.name}</TableCell>
                  <TableCell align="right" className="tabular-nums">{formatPrice(s.grossAmount)}</TableCell>
                  <TableCell align="right" className="tabular-nums">{formatPrice(s.feeAmount)}</TableCell>
                  <TableCell align="right" className="tabular-nums">{s.adjustmentAmount ? formatPrice(s.adjustmentAmount) : "—"}</TableCell>
                  <TableCell align="right" className="tabular-nums font-medium">{formatPrice(s.netAmount)}</TableCell>
                  <TableCell><Badge variant={STATUS_BADGE[s.status]}>{s.status.toLowerCase()}</Badge></TableCell>
                  <TableCell align="right">
                    <span className="flex justify-end gap-1">
                      {s.status === "DRAFT" && s.unmatchedLines > 0 && can("finance.transact") && (
                        <Button size="sm" variant="outline" loading={outside.isPending && outside.variables === s.id} onClick={async () => { if (await confirm(`${s.unmatchedLines} parcel(s) in ${s.reference} match no order on the site. Count them as sales outside the website (sent straight through the courier)?`, { title: "Sales outside the website", confirmLabel: "Count them", tone: "default" })) outside.mutate(s.id); }} data-testid="mark-outside-sales">Outside sales</Button>
                      )}
                      {s.status === "DRAFT" && can("finance.post") && <Button size="sm" loading={post.isPending && post.variables === s.id} onClick={() => post.mutate(s.id)} data-testid="post-settlement">Post</Button>}
                      {s.status === "DRAFT" && can("finance.transact") && (
                        <Button size="sm" variant="ghost" aria-label="Delete draft" onClick={async () => { if (await confirm(`Delete the draft settlement ${s.reference}?`)) remove.mutate(s.id); }}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                      {s.status === "POSTED" && can("finance.reverse") && <Button size="sm" variant="outline" onClick={() => { setReason(""); setReversing(s); }}>Reverse</Button>}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </tbody>
          </Table>
        </HScrollShadow>
        {list.data?.settlements.length === 0 && <EmptyState icon={Truck} title="No settlements yet" description="Record one when a courier or gateway pays out." />}
      </Card>

      {mode && <SettlementModal mode={mode} clearing={clearing} destinations={destinations} onClose={() => setMode(null)} onDone={() => { refresh(); setMode(null); }} />}
      {reversing && (
        <Modal
          open
          onClose={() => setReversing(null)}
          title="Reverse settlement"
          description={`${reversing.reference} — a reversing journal is posted; the original stays in the books.`}
          widthClassName="max-w-md"
          footer={
            <>
              <Button variant="outline" onClick={() => setReversing(null)}>Cancel</Button>
              <Button variant="destructive" loading={reverse.isPending} disabled={reason.trim().length < 3} onClick={() => reverse.mutate()}>Reverse</Button>
            </>
          }
        >
          <Field htmlFor="rev-reason" label="Reason" required>
            <Textarea id="rev-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
          </Field>
        </Modal>
      )}
    </div>
  );
}

function SettlementModal({ mode, clearing, destinations, onClose, onDone }: { mode: "manual" | "csv"; clearing: FinancialAccount[]; destinations: FinancialAccount[]; onClose: () => void; onDone: () => void }) {
  const [head, setHead] = useState({ clearingFinancialAccountId: clearing[0]?.id ?? "", destinationFinancialAccountId: destinations[0]?.id ?? "", settlementDate: today(), reference: "", evidence: "", adjustmentAmount: "", adjustmentReason: "" });
  const [lines, setLines] = useState<Line[]>([blankLine()]);
  const [csv, setCsv] = useState("");
  const [map, setMap] = useState({ orderNumber: "order", externalRef: "", amount: "amount", fee: "fee", adjustment: "" });
  const set = (k: keyof typeof head) => (e: { target: { value: string } }) => setHead((h) => ({ ...h, [k]: e.target.value }));
  const filled = lines.filter((l) => l.amount.trim());
  const gross = filled.reduce((s, l) => s + Number(l.amount || 0), 0);
  const fees = filled.reduce((s, l) => s + Number(l.fee || 0), 0);
  const adjustment = Number(head.adjustmentAmount || 0);

  const save = useMutation({
    mutationFn: async () => {
      const base = {
        clearingFinancialAccountId: head.clearingFinancialAccountId,
        destinationFinancialAccountId: head.destinationFinancialAccountId,
        settlementDate: head.settlementDate,
        reference: head.reference.trim(),
        evidence: head.evidence.trim() || null,
        adjustmentReason: head.adjustmentReason.trim() || null,
      };
      if (mode === "csv") {
        const mapping = Object.fromEntries(Object.entries(map).filter(([, v]) => v.trim()));
        return financeApi.importSettlement({ ...base, csv, mapping, hasHeader: true });
      }
      const body = {
        ...base,
        adjustmentAmount: adjustment || null,
        lines: filled.map((l) => ({ orderNumber: l.orderNumber.trim() || null, amount: Number(l.amount), fee: Number(l.fee || 0) })),
      };
      return financeApi.createSettlement(body, idempotencyKeyFor("finance-settlement", body));
    },
    onSuccess: (r) => {
      toast.success(r.replayed ? "Already recorded — the existing draft is shown" : `Draft saved${r.settlement.unmatchedLines ? ` · ${r.settlement.unmatchedLines} line(s) didn't match an order` : ""}`);
      onDone();
    },
    onError: (err) => toast.error(getErrorMessage(err, "The settlement couldn't be saved")),
  });
  const valid = head.clearingFinancialAccountId && head.destinationFinancialAccountId && head.reference.trim() && (mode === "csv" ? csv.trim() && map.amount.trim() : filled.length > 0) && (!adjustment || head.adjustmentReason.trim());

  return (
    <Modal
      open
      onClose={onClose}
      title={mode === "csv" ? "Import a settlement statement" : "New settlement"}
      description="Saved as a draft — nothing reaches the books until it is posted."
      widthClassName="max-w-2xl"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button loading={save.isPending} disabled={!valid} onClick={() => save.mutate()} data-testid="save-settlement">Save draft</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field htmlFor="st-from" label="Paid out by (clearing)" required>
            <Select id="st-from" value={head.clearingFinancialAccountId} onChange={set("clearingFinancialAccountId")}>
              {clearing.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          </Field>
          <Field htmlFor="st-to" label="Into" required>
            <Select id="st-to" value={head.destinationFinancialAccountId} onChange={set("destinationFinancialAccountId")}>
              {destinations.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          </Field>
          <Field htmlFor="st-date" label="Settlement date" required>
            <Input id="st-date" type="date" value={head.settlementDate} onChange={set("settlementDate")} />
          </Field>
          <Field htmlFor="st-ref" label="Statement / payout reference" required>
            <Input id="st-ref" value={head.reference} onChange={set("reference")} maxLength={120} />
          </Field>
        </div>
        {mode === "manual" ? (
          <div className="space-y-2">
            <p className="text-xs text-ink-500">One line per order on the statement. Fees are only what the statement shows.</p>
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-[1fr_8rem_7rem_2rem] gap-2">
                <Input aria-label={`Order number ${i + 1}`} placeholder="Order number" value={l.orderNumber} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, orderNumber: e.target.value } : x)))} />
                <Input aria-label={`Amount ${i + 1}`} placeholder="Collected" inputMode="decimal" value={l.amount} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
                <Input aria-label={`Fee ${i + 1}`} placeholder="Fee" inputMode="decimal" value={l.fee} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, fee: e.target.value } : x)))} />
                <Button variant="ghost" size="sm" aria-label="Remove line" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, blankLine()])}><Plus className="h-4 w-4" /> Add line</Button>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field htmlFor="st-adj" label="Adjustment (signed)" hint="Only what the statement shows; it needs a reason.">
                <Input id="st-adj" inputMode="decimal" value={head.adjustmentAmount} onChange={set("adjustmentAmount")} />
              </Field>
              <Field htmlFor="st-adjr" label="Adjustment reason">
                <Input id="st-adjr" value={head.adjustmentReason} onChange={set("adjustmentReason")} maxLength={300} />
              </Field>
            </div>
            <p className="text-sm text-ink-700" data-testid="settlement-net">
              Gross {formatPrice(gross)} − fees {formatPrice(fees)} {adjustment ? `− adjustment ${formatPrice(adjustment)} ` : ""}= paid out <span className="font-semibold">{formatPrice(gross - fees - adjustment)}</span>
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <Field htmlFor="st-file" label="Statement file (CSV)" required>
              <input
                id="st-file"
                type="file"
                accept=".csv,text/csv"
                className="block text-sm"
                onChange={async (e) => { const f = e.target.files?.[0]; setCsv(f ? await f.text() : ""); }}
              />
            </Field>
            <p className="text-xs text-ink-500">Which header names hold each value. A row matches an order by its order number, or a gateway transaction id.</p>
            <div className="grid gap-3 sm:grid-cols-3">
              {(Object.keys(map) as Array<keyof typeof map>).map((k) => (
                <Field key={k} htmlFor={`map-${k}`} label={{ orderNumber: "Order number column", externalRef: "Transaction id column", amount: "Amount column", fee: "Fee column", adjustment: "Adjustment column" }[k]} required={k === "amount"}>
                  <Input id={`map-${k}`} value={map[k]} onChange={(e) => setMap((m) => ({ ...m, [k]: e.target.value }))} />
                </Field>
              ))}
            </div>
            <Field htmlFor="st-adjr2" label="Adjustment reason (if the file has adjustments)">
              <Input id="st-adjr2" value={head.adjustmentReason} onChange={set("adjustmentReason")} maxLength={300} />
            </Field>
          </div>
        )}
        <Field htmlFor="st-ev" label="Evidence / note">
          <Input id="st-ev" value={head.evidence} onChange={set("evidence")} maxLength={300} />
        </Field>
      </div>
    </Modal>
  );
}
