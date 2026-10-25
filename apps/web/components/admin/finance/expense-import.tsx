"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { HScrollShadow } from "@/components/ui/h-scroll-shadow";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Table, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { getErrorMessage } from "@/lib/api-client";
import * as financeApi from "@/lib/api/finance";
import type { ExpenseImportPreview } from "@/lib/api/finance";
import { formatBookDate, formatPrice } from "@/lib/format";

const SAMPLE = "date,category,amount,paid from,payee,description,reference\n2026-09-05,SMS,500,Shop bKash,BulkSMSBD,SMS recharge,TRX123\n2026-09-10,Rent,8000,owner,Landlord,September rent,";

/** Expenses from a file (docs/FINANCE_EXPENSES.md §6): paste or choose a CSV, see every row checked — nothing is written —
 * then record the good ones. The same file twice records nothing new. */
export function ExpenseImportModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<ExpenseImportPreview | null>(null);
  const [withDuplicates, setWithDuplicates] = useState(false);
  const check = useMutation({ mutationFn: () => financeApi.previewExpenseImport(csv), onSuccess: setPreview, onError: (e) => toast.error(getErrorMessage(e, "The file couldn't be read")) });
  const commit = useMutation({
    mutationFn: () => financeApi.commitExpenseImport(csv, withDuplicates),
    onSuccess: (r) => {
      if (r.failed) toast.warning(`${r.recorded} recorded, ${r.failed} not — ${r.results.find((x) => x.status === "FAILED")?.problem ?? ""}`);
      else toast.success(`${r.recorded} expense${r.recorded === 1 ? "" : "s"} recorded`);
      onDone();
    },
    onError: (e) => toast.error(getErrorMessage(e, "The expenses couldn't be recorded")),
  });
  const count = preview ? preview.totals.ok + (withDuplicates ? preview.totals.duplicates : 0) : 0;
  return (
    <Modal
      open
      onClose={onClose}
      title="Expenses from a file"
      description="One row per payment: date, category, amount, paid from (a money account, or owner / owner capital), and optionally payee, description, reference."
      widthClassName="max-w-4xl"
      footer={<>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        {!preview ? <Button loading={check.isPending} disabled={!csv.trim()} onClick={() => check.mutate()} data-testid="import-check">Check the file</Button>
          : <Button loading={commit.isPending} disabled={!count} onClick={() => commit.mutate()} data-testid="import-commit">Record {count} expense{count === 1 ? "" : "s"}</Button>}
      </>}
    >
      {!preview ? (
        <div className="space-y-3">
          <Field htmlFor="import-file" label="Choose a CSV file">
            <Input id="import-file" type="file" accept=".csv,text/csv,.txt" onChange={(e) => { const f = e.target.files?.[0]; if (f) void f.text().then(setCsv); }} />
          </Field>
          <Field htmlFor="import-csv" label="…or paste it" hint="Excel: File › Save as › CSV. Dates as 2026-09-05 or 05/09/2026; the taka sign and commas in amounts are fine.">
            <Textarea id="import-csv" rows={8} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={SAMPLE} className="font-mono text-xs" data-testid="import-csv" />
          </Field>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2 text-sm">
            <Badge variant="success">{preview.totals.ok} ready · {formatPrice(preview.totals.amount)}</Badge>
            {preview.totals.duplicates > 0 && <Badge variant="warning">{preview.totals.duplicates} look already recorded</Badge>}
            {preview.totals.problems > 0 && <Badge variant="danger">{preview.totals.problems} with a problem</Badge>}
          </div>
          {preview.totals.duplicates > 0 && (
            <label className="flex min-h-11 items-center gap-2 text-sm text-fg">
              <Checkbox checked={withDuplicates} onChange={(e) => setWithDuplicates(e.target.checked)} />
              Record the ones that look already recorded too (only if they really are separate payments)
            </label>
          )}
          {preview.totals.problems > 0 && <Alert variant="warning">Rows with a problem are left out. Fix them in the file (or add the missing category) and check it again.</Alert>}
          <HScrollShadow className="max-h-[50vh] overflow-auto rounded-xl border border-line-subtle">
            <Table>
              <TableHead>
                <tr><TableHeaderCell>Line</TableHeaderCell><TableHeaderCell>Date</TableHeaderCell><TableHeaderCell>Category</TableHeaderCell><TableHeaderCell align="right">Amount</TableHeaderCell><TableHeaderCell>Paid from</TableHeaderCell><TableHeaderCell>Payee</TableHeaderCell><TableHeaderCell>Status</TableHeaderCell></tr>
              </TableHead>
              <tbody>
                {preview.rows.map((r) => (
                  <TableRow key={r.line}>
                    <TableCell className="tabular-nums text-fg-muted">{r.line}</TableCell>
                    <TableCell className="whitespace-nowrap">{r.date ? formatBookDate(r.date) : "—"}</TableCell>
                    <TableCell>{r.category ? `${r.category.code} ${r.category.name}` : "—"}</TableCell>
                    <TableCell align="right" className="tabular-nums">{r.amount === null ? "—" : formatPrice(r.amount)}</TableCell>
                    <TableCell>{r.paidFrom ? (r.paidFrom.kind === "OWNER" ? (r.paidFrom.funding === "CAPITAL" ? "Owner (capital)" : "Owner (pay back)") : r.paidFrom.name) : "—"}</TableCell>
                    <TableCell>{r.payee ?? "—"}</TableCell>
                    <TableCell>{r.status === "OK" ? <Badge variant="success">Ready</Badge> : <span className={r.status === "DUPLICATE" ? "text-warning-700" : "text-danger-700"}>{r.problem}</span>}</TableCell>
                  </TableRow>
                ))}
              </tbody>
            </Table>
          </HScrollShadow>
          <Button variant="ghost" size="sm" onClick={() => setPreview(null)}>Change the file</Button>
        </div>
      )}
    </Modal>
  );
}

/** A new expense category: a postable expense account numbered after the last one, under the same heading. */
export function NewCategoryModal({ onClose, onDone }: { onClose: () => void; onDone: (id: string) => void }) {
  const qc = useQueryClient();
  const chart = useQuery({ queryKey: financeApi.ledgerKeys.chart(), queryFn: financeApi.listChart });
  const [name, setName] = useState("");
  const next = useMemo(() => {
    const exp = (chart.data?.accounts ?? []).filter((a) => a.type === "EXPENSE" && a.isPostable && /^6\d{3}$/.test(a.code));
    const codes = new Set((chart.data?.accounts ?? []).map((a) => a.code));
    let n = Math.max(6000, ...exp.map((a) => Number(a.code))) + 10;
    while (codes.has(String(n)) && n < 6999) n += 1;
    const parents = new Map<string, number>();
    for (const a of exp) if (a.parentId) parents.set(a.parentId, (parents.get(a.parentId) ?? 0) + 1);
    const parentId = [...parents.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    return { code: String(n), parentId, taken: (chart.data?.accounts ?? []).some((a) => a.name.trim().toLowerCase() === name.trim().toLowerCase()) };
  }, [chart.data, name]);
  const save = useMutation({
    mutationFn: () => financeApi.createExpenseCategory({ code: next.code, name: name.trim(), parentId: next.parentId }),
    onSuccess: (a) => { void qc.invalidateQueries({ queryKey: financeApi.ledgerKeys.chart() }); toast.success(`${a.name} added (${a.code})`); onDone(a.id); },
    onError: (e) => toast.error(getErrorMessage(e, "The category couldn't be added")),
  });
  const ok = name.trim().length >= 2 && !next.taken && Number(next.code) <= 6999;
  return (
    <Modal open onClose={onClose} title="New expense category" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={!ok || chart.isLoading} onClick={() => save.mutate()} data-testid="new-category-save">Add category</Button></>}>
      <div className="space-y-3">
        <Field htmlFor="new-category-name" label="Name" required error={next.taken ? "A category with this name exists" : undefined} hint={`It becomes account ${next.code} in the chart of accounts.`}>
          <Input id="new-category-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="e.g. Vehicle fuel" data-testid="new-category-name" />
        </Field>
      </div>
    </Modal>
  );
}
