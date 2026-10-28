"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HandCoins } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Money } from "@/components/ui/money";
import { Select } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { DataTable } from "@/components/admin/data-table";
import type { DataTableColumn } from "@/components/admin/data-table/types";
import { EmptyState } from "@/components/admin/empty-state";
import { getErrorMessage } from "@/lib/api-client";
import * as financeApi from "@/lib/api/finance";
import type { OwnerAdvanceLine } from "@/lib/api/finance";
import { formatBookDate, formatPrice } from "@/lib/format";
import { idempotencyKeyFor, settleIdempotencyKey } from "@/lib/idempotency";

const SOURCE: Record<OwnerAdvanceLine["sourceType"], string> = { StockPurchase: "Purchase", Expense: "Expense" };
const PAYING = new Set(["CASH", "BANK", "MOBILE_WALLET"]);
const today = () => new Date().toLocaleDateString("en-CA");
const amountOk = (s: string) => /^\d+(\.\d{1,2})?$/.test(s.trim()) && Number(s) > 0;

/**
 * Owed back to the owner (blueprint P1.4, owner decision Q-F): every purchase or expense he paid from his own pocket to
 * be repaid, what is left on each, and "Repay owner", which pays chosen lines from one account and links the repayment
 * to them. Owner-only, like the page it sits on.
 */
export function OwedToOwner({ canRepay }: { canRepay: boolean }) {
  const q = useQuery({ queryKey: financeApi.equityKeys.ownerAdvances(), queryFn: financeApi.getOwnerAdvances });
  const [repaying, setRepaying] = useState(false);
  const open = (q.data?.lines ?? []).filter((l) => l.outstanding > 0);
  const columns: DataTableColumn<OwnerAdvanceLine>[] = [
    {
      id: "what",
      header: "What he paid for",
      card: "title",
      cell: (l) => (
        <span className="block min-w-0">
          <span className="block font-medium text-fg">{l.description}</span>
          <span className="block text-xs text-fg-muted">{SOURCE[l.sourceType]} · {formatBookDate(l.date)}</span>
        </span>
      ),
    },
    { id: "amount", header: "Paid", align: "right", cell: (l) => <Money value={l.amount} /> },
    { id: "repaid", header: "Repaid", align: "right", cell: (l) => <Money value={l.repaid} /> },
    { id: "left", header: "Still owed", align: "right", cell: (l) => (l.outstanding > 0 ? <Money value={l.outstanding} className="font-medium" /> : <Badge variant="success">Repaid</Badge>) },
  ];
  return (
    <Card className="space-y-4 p-5 sm:p-6" data-testid="owed-to-owner">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[17px] font-semibold tracking-tight text-fg">Owed back to the owner</h2>
          <p className="text-sm text-fg-muted">What he paid from his own pocket to be repaid, line by line.</p>
        </div>
        <div className="flex items-center gap-3">
          {q.data && <span className="text-lg font-semibold tabular-nums text-fg" data-testid="owed-total">{formatPrice(q.data.outstanding)}</span>}
          {canRepay && <Button size="sm" onClick={() => setRepaying(true)} disabled={!open.length} data-testid="repay-owner">Repay owner</Button>}
        </div>
      </div>
      {q.data && q.data.unlinked !== 0 && (
        <Alert variant="info" title={q.data.unlinked > 0 ? `${formatPrice(q.data.unlinked)} more is owed in the books` : `${formatPrice(-q.data.unlinked)} has been repaid without a line`}>
          {q.data.unlinked > 0
            ? "It isn't linked to a purchase or expense — owed from before lines were kept. It stays in the books as it is."
            : "A repayment is waiting for approval, or he was repaid with a plain withdrawal that doesn't say what for."}
        </Alert>
      )}
      <DataTable
        caption="Owed back to the owner"
        columns={columns}
        rows={q.data?.lines}
        getRowId={(l) => l.id}
        loading={q.isLoading}
        error={q.error}
        onRetry={() => void q.refetch()}
        cardBelow="md"
        empty={<EmptyState icon={HandCoins} title="Nothing is owed back to him" description="When the owner pays a purchase or an expense from his own pocket to be repaid, it shows here." />}
      />
      {repaying && <RepayDialog lines={open} onClose={() => setRepaying(false)} />}
    </Card>
  );
}

function RepayDialog({ lines, onClose }: { lines: OwnerAdvanceLine[]; onClose: () => void }) {
  const qc = useQueryClient();
  const scope = useRef(`repay-owner:${Date.now().toString(36)}`).current;
  const accountsQ = useQuery({ queryKey: financeApi.financeKeys.accounts(), queryFn: financeApi.listFinancialAccounts });
  const accounts = (accountsQ.data?.financialAccounts ?? []).filter((a) => a.isActive && PAYING.has(a.kind) && !a.name.endsWith("— own money"));
  const [from, setFrom] = useState("");
  const [date, setDate] = useState(today());
  const [note, setNote] = useState("");
  const [tried, setTried] = useState(false);
  const [chosen, setChosen] = useState<Record<string, string>>(() => Object.fromEntries(lines.map((l) => [l.id, String(l.outstanding)])));
  const picked = lines.filter((l) => chosen[l.id] !== undefined);
  const errorOf = (l: OwnerAdvanceLine) => {
    const v = chosen[l.id];
    if (v === undefined) return null;
    if (!amountOk(v)) return "Enter an amount";
    if (Number(v) > l.outstanding) return `At most ${formatPrice(l.outstanding)}`;
    return null;
  };
  const total = picked.reduce((s, l) => s + (amountOk(chosen[l.id]!) ? Number(chosen[l.id]) : 0), 0);
  const valid = Boolean(from) && picked.length > 0 && picked.every((l) => !errorOf(l));
  const body = () => ({ fromFinancialAccountId: from, date, note: note.trim() || null, lines: picked.map((l) => ({ advanceId: l.id, amount: Number(chosen[l.id]) })) });
  const save = useMutation({
    mutationFn: () => {
      const b = body();
      return financeApi.repayOwner(b, idempotencyKeyFor(scope, b));
    },
    onSuccess: (r) => {
      settleIdempotencyKey(scope);
      toast.success(r.movement.status === "POSTED" ? `Repaid ${formatPrice(total)} to the owner` : "Repayment recorded — it waits for approval");
      void qc.invalidateQueries({ queryKey: ["finance"] });
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="Repay owner"
      description="Pay him back for what he paid from his own pocket. Each line says what this repays."
      widthClassName="max-w-lg"
      footer={
        <>
          <p className="mr-auto self-center text-sm text-fg-muted max-sm:order-last" aria-live="polite">Total <span className="font-semibold tabular-nums text-fg">{formatPrice(total)}</span></p>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button loading={save.isPending} onClick={() => { setTried(true); if (valid) save.mutate(); }} data-testid="repay-save">Repay</Button>
        </>
      }
    >
      <div className="space-y-5">
        {save.isError && <Alert variant="danger" title="The repayment wasn't recorded">{getErrorMessage(save.error, "Try again.")}</Alert>}
        <fieldset className="space-y-3">
          <legend className="mb-1 text-sm font-medium text-fg">What it repays</legend>
          {lines.map((l) => {
            const on = chosen[l.id] !== undefined;
            const error = tried ? errorOf(l) : null;
            return (
              <div key={l.id} className="flex flex-wrap items-start gap-3 rounded-xl border border-line-subtle p-3" data-testid="repay-line">
                <label className="flex min-w-0 flex-1 items-start gap-2.5 text-sm">
                  <Checkbox className="mt-0.5" checked={on} onChange={(e) => setChosen((c) => { const n = { ...c }; if (e.target.checked) n[l.id] = String(l.outstanding); else delete n[l.id]; return n; })} />
                  <span className="min-w-0">
                    <span className="block font-medium text-fg">{l.description}</span>
                    <span className="block text-xs text-fg-muted">{SOURCE[l.sourceType]} · {formatBookDate(l.date)} · {formatPrice(l.outstanding)} still owed</span>
                  </span>
                </label>
                {on && (
                  <Field htmlFor={`repay-${l.id}`} label="Amount" className="w-32" error={error ?? undefined}>
                    <Input id={`repay-${l.id}`} inputMode="decimal" className="tabular-nums" value={chosen[l.id]} onChange={(e) => setChosen((c) => ({ ...c, [l.id]: e.target.value }))} />
                  </Field>
                )}
              </div>
            );
          })}
          {tried && !picked.length && <p className="text-sm text-danger-600" role="alert">Tick at least one line</p>}
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field htmlFor="repay-from" label="Paid from" required error={tried && !from ? "Choose the account" : undefined}>
            <Select id="repay-from" value={from} onChange={(e) => setFrom(e.target.value)} disabled={accountsQ.isLoading} data-testid="repay-from">
              <option value="">{accountsQ.isLoading ? "Loading…" : "Choose…"}</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({formatPrice(a.currentBalance)})</option>)}
            </Select>
          </Field>
          <Field htmlFor="repay-date" label="Date">
            <Input id="repay-date" type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        <Field htmlFor="repay-note" label="Note (optional)">
          <Input id="repay-note" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
