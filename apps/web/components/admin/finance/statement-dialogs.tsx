"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { getErrorMessage } from "@/lib/api-client";
import * as financeApi from "@/lib/api/finance";
import type { StatementImportInput, StatementPreview } from "@/lib/api/finance";
import { formatPrice } from "@/lib/format";
import { idempotencyKeyFor, settleIdempotencyKey } from "@/lib/idempotency";
import { STATEMENT_DATE_FORMATS } from "@clothing-brand/shared";

const MAPPING_FIELDS: Array<[keyof financeApi.StatementMapping, string]> = [
  ["date", "Date"],
  ["description", "Description"],
  ["reference", "Reference"],
  ["debit", "Money out (debit)"],
  ["credit", "Money in (credit)"],
  ["amount", "Signed amount"],
  ["balance", "Balance"],
  ["externalId", "Transaction id"],
  ["valueDate", "Value date"],
];

/**
 * CSV statement import (docs/FINANCE_PHASE_2.md §5). Columns are mapped by the person importing — no bank's layout is
 * assumed — and the preview shows what would be added and what is already there before anything is written. Importing
 * the same file, or an overlapping one, never duplicates a line.
 */
export function StatementImportDialog({ accountId, onClose }: { accountId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [fileName, setFileName] = useState<string | null>(null);
  const [csv, setCsv] = useState("");
  const [mapping, setMapping] = useState<financeApi.StatementMapping>({ date: "Date", description: "Description", debit: "Debit", credit: "Credit", balance: "Balance" });
  const [dateFormat, setDateFormat] = useState<string>("DD/MM/YYYY");
  const [amountConvention, setConvention] = useState<financeApi.StatementOptions["amountConvention"]>("POSITIVE_IS_MONEY_IN");
  const [skipRows, setSkipRows] = useState(0);
  const [preview, setPreview] = useState<StatementPreview | null>(null);

  const input = (): StatementImportInput => ({
    financialAccountId: accountId,
    fileName,
    csv,
    mapping: Object.fromEntries(Object.entries(mapping).filter(([, v]) => v && String(v).trim())) as financeApi.StatementMapping,
    options: { dateFormat, amountConvention, hasHeader: true, skipRows },
  });

  const previewMutation = useMutation({
    mutationFn: () => financeApi.previewStatementImport(input()),
    onSuccess: setPreview,
    onError: (err) => toast.error(getErrorMessage(err, "The statement couldn't be read")),
  });
  const importMutation = useMutation({
    mutationFn: () => financeApi.importStatement(input()),
    onSuccess: ({ import: imp, replayed }) => {
      void queryClient.invalidateQueries({ queryKey: financeApi.financeKeys.all });
      toast.success(replayed ? "This file was already imported — nothing added" : `${imp.importedCount} line(s) imported · ${imp.duplicateCount} already there · ${imp.errorCount} not readable`);
      onClose();
    },
    onError: (err) => toast.error(getErrorMessage(err, "The statement couldn't be imported")),
  });

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    setCsv(await file.text());
    setPreview(null);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Import a statement"
      description="Upload the CSV your bank, wallet or gateway gives you and tell us which column is which."
      widthClassName="max-w-3xl"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="outline" disabled={!csv} loading={previewMutation.isPending} onClick={() => previewMutation.mutate()} data-testid="preview-import">
            Preview
          </Button>
          <Button disabled={!preview || preview.newRows === 0} loading={importMutation.isPending} onClick={() => importMutation.mutate()} data-testid="confirm-import">
            Import {preview ? `${preview.newRows} line(s)` : ""}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field htmlFor="st-file" label="CSV file" required>
          <Input id="st-file" type="file" accept=".csv,text/csv" onChange={(e) => void onFile(e.target.files?.[0])} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field htmlFor="st-date-format" label="Date format">
            <Select id="st-date-format" value={dateFormat} onChange={(e) => { setDateFormat(e.target.value); setPreview(null); }}>
              {STATEMENT_DATE_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </Select>
          </Field>
          <Field htmlFor="st-skip" label="Lines before the header">
            <Input id="st-skip" type="number" min={0} max={50} value={skipRows} onChange={(e) => { setSkipRows(Number(e.target.value) || 0); setPreview(null); }} />
          </Field>
          <Field htmlFor="st-convention" label="A positive signed amount is">
            <Select id="st-convention" value={amountConvention} onChange={(e) => { setConvention(e.target.value as typeof amountConvention); setPreview(null); }}>
              <option value="POSITIVE_IS_MONEY_IN">money in</option>
              <option value="POSITIVE_IS_MONEY_OUT">money out</option>
            </Select>
          </Field>
        </div>
        <fieldset>
          <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">Column names in your file</legend>
          <p className="mb-2 text-xs text-ink-500">Map either the debit and credit columns, or one signed amount column. Leave unused fields empty.</p>
          <div className="grid gap-3 sm:grid-cols-3">
            {MAPPING_FIELDS.map(([field, label]) => (
              <Field key={field} htmlFor={`st-map-${field}`} label={label} required={field === "date"}>
                <Input
                  id={`st-map-${field}`}
                  value={mapping[field] ?? ""}
                  onChange={(e) => {
                    setMapping((m) => ({ ...m, [field]: e.target.value }));
                    setPreview(null);
                  }}
                  list="st-headers"
                />
              </Field>
            ))}
          </div>
          {preview?.header && (
            <datalist id="st-headers">
              {preview.header.map((h) => (
                <option key={h} value={h} />
              ))}
            </datalist>
          )}
        </fieldset>
        {preview && (
          <div className="space-y-2" data-testid="import-preview">
            <p className="text-sm text-ink-700">
              {preview.rowCount} row(s) · <span className="font-medium text-ink-900">{preview.newRows} new</span> · {preview.duplicateRows} already imported · {preview.errors.length} not readable
            </p>
            {preview.errors.length > 0 && (
              <Alert variant="warning" title="Rows that won't be imported">
                <ul className="list-disc pl-4">
                  {preview.errors.slice(0, 8).map((e) => (
                    <li key={`${e.line}-${e.message}`}>
                      Line {e.line}: {e.message}
                    </li>
                  ))}
                </ul>
              </Alert>
            )}
            <ul className="max-h-56 divide-y divide-line-subtle overflow-auto rounded-xl border border-line-subtle text-sm">
              {preview.rows.map((r) => (
                <li key={r.line} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="text-ink-600">{r.transactionDate}</span>
                  <span className="flex-1 truncate text-ink-900">{r.description}</span>
                  <span className={r.credit > 0 ? "tabular-nums text-success-700" : "tabular-nums text-ink-900"}>{r.credit > 0 ? `+${formatPrice(r.credit)}` : `−${formatPrice(r.debit)}`}</span>
                  {r.duplicate && <span className="text-xs text-ink-400">already there</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}

/** A statement line entered by hand — evidence of what the institution recorded, matched later; it never posts. */
export function StatementLineDialog({ accountId, onClose }: { accountId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [transactionDate, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [direction, setDirection] = useState<"in" | "out">("out");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [reference, setReference] = useState("");
  const [externalId, setExternalId] = useState("");
  const scope = `finance-statement-line:${accountId}`;
  const body = {
    financialAccountId: accountId,
    transactionDate,
    description: description.trim(),
    reference: reference.trim() || null,
    externalId: externalId.trim() || null,
    debit: direction === "out" ? Number(amount) : 0,
    credit: direction === "in" ? Number(amount) : 0,
  };
  const create = useMutation({
    mutationFn: () => financeApi.createBankTransaction(body, idempotencyKeyFor(scope, body)),
    onSuccess: ({ replayed }) => {
      settleIdempotencyKey(scope);
      void queryClient.invalidateQueries({ queryKey: financeApi.financeKeys.all });
      toast.success(replayed ? "That line was already entered" : "Statement line added");
      onClose();
    },
    onError: (err) => toast.error(getErrorMessage(err, "The line couldn't be added")),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="Add a statement line"
      description="Type a line from the bank, wallet or gateway statement. It doesn't change the books — match it to them."
      widthClassName="max-w-lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!(Number(amount) > 0) || !description.trim()} loading={create.isPending} onClick={() => create.mutate()}>
            Add line
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field htmlFor="sl-date" label="Date" required>
          <Input id="sl-date" type="date" value={transactionDate} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field htmlFor="sl-direction" label="Direction" required>
          <Select id="sl-direction" value={direction} onChange={(e) => setDirection(e.target.value as "in" | "out")}>
            <option value="in">Money in (credit)</option>
            <option value="out">Money out (debit)</option>
          </Select>
        </Field>
        <Field htmlFor="sl-amount" label="Amount" required>
          <Input id="sl-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field htmlFor="sl-external" label="Transaction id" hint="The bank's id, if it shows one">
          <Input id="sl-external" value={externalId} onChange={(e) => setExternalId(e.target.value)} maxLength={120} />
        </Field>
        <Field htmlFor="sl-description" label="Description" required className="sm:col-span-2">
          <Input id="sl-description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} />
        </Field>
        <Field htmlFor="sl-reference" label="Reference" className="sm:col-span-2">
          <Input id="sl-reference" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} />
        </Field>
      </div>
    </Modal>
  );
}
