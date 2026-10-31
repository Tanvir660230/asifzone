"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Download } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { HScrollShadow } from "@/components/ui/h-scroll-shadow";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/admin/empty-state";
import { ModuleTabs } from "@/components/admin/module-tabs";
import { PageHeader } from "@/components/admin/page-header";
import { useCapabilities } from "@/hooks/use-capability";
import { getErrorMessage } from "@/lib/api-client";
import type { Capability } from "@/lib/admin/capabilities";
import * as purchasingApi from "@/lib/api/purchasing";
import type { ReportId } from "@/lib/api/purchasing";
import { downloadCsv, toCsv } from "@/lib/csv";
import { formatPrice } from "@/lib/format";
import { PermissionState } from "@/components/admin/permission-state";

type Format = "money" | "int" | "pct" | "text";
interface Column { key: string; label: string; format: Format }
interface Shaped { columns: Column[]; rows: Array<Record<string, unknown>>; totals: Array<{ label: string; value: number; format?: Format }>; tie: string }

const num = (v: unknown) => (typeof v === "number" ? v : 0);
const arr = (v: unknown) => (Array.isArray(v) ? (v as Array<Record<string, unknown>>) : []);
const obj = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

/** Each report: who may see it, whether it takes a period, and how its response becomes a table + tie-out totals. */
const REPORTS: Record<ReportId, { label: string; capability: Capability; period: boolean; search?: boolean; shape: (d: Record<string, unknown>) => Shaped }> = {
  "purchase-register": {
    label: "Purchase register", capability: "purchasing.view", period: true,
    shape: (d) => ({
      columns: [{ key: "supplier", label: "Supplier", format: "text" }, { key: "received", label: "Received", format: "money" }, { key: "billed", label: "Billed", format: "money" }, { key: "credited", label: "Credited", format: "money" }, { key: "netBilled", label: "Net billed", format: "money" }],
      rows: arr(d.suppliers).map((s) => ({ ...s, supplier: obj(s.supplier).displayName })),
      totals: [{ label: "Received", value: num(obj(d.totals).received) }, { label: "Billed", value: num(obj(d.totals).billed) }, { label: "Credited", value: num(obj(d.totals).credited) }],
      tie: "Received = posted goods receipts; billed and credited = posted bills and credit notes of the period.",
    }),
  },
  "grni-ageing": {
    label: "Received, not billed", capability: "purchasing.view", period: false,
    shape: (d) => ({
      columns: [{ key: "number", label: "Receipt", format: "text" }, { key: "date", label: "Date", format: "text" }, { key: "ageDays", label: "Days", format: "int" }, { key: "supplier", label: "Supplier", format: "text" }, { key: "sku", label: "SKU", format: "text" }, { key: "unbilledQty", label: "Units", format: "int" }, { key: "unbilled", label: "Not billed", format: "money" }],
      rows: arr(d.open),
      totals: [{ label: "0–30 days", value: num(obj(d.buckets).d0_30) }, { label: "31–60", value: num(obj(d.buckets).d31_60) }, { label: "61–90", value: num(obj(d.buckets).d61_90) }, { label: "90+", value: num(obj(d.buckets).d90_plus) }, { label: "Returned, not credited", value: -num(d.returnedNotCredited) }, { label: "Goods received not invoiced", value: num(d.grni) }],
      tie: "The last figure equals the GRNI account (Books health check → Goods received not invoiced).",
    }),
  },
  "price-variance": {
    label: "Price variance", capability: "purchasing.view", period: true,
    shape: (d) => ({
      columns: [{ key: "bill", label: "Bill", format: "text" }, { key: "date", label: "Date", format: "text" }, { key: "supplier", label: "Supplier", format: "text" }, { key: "sku", label: "SKU", format: "text" }, { key: "quantity", label: "Units", format: "int" }, { key: "orderedUnitPrice", label: "Ordered", format: "money" }, { key: "billedUnitPrice", label: "Billed", format: "money" }, { key: "variancePct", label: "Variance %", format: "pct" }, { key: "variance", label: "Variance", format: "money" }, { key: "booked", label: "Booked to cost", format: "money" }],
      rows: arr(d.rows),
      totals: [{ label: "Variance vs order", value: num(obj(d.totals).variance) }, { label: "Price differences booked", value: num(obj(d.totals).booked) }],
      tie: "Booked = what the bills put on the goods' cost (stock still held revalued, the sold share in cost adjustments).",
    }),
  },
  "inventory-valuation": {
    label: "Inventory valuation", capability: "costing.view", period: false, search: true,
    shape: (d) => ({
      columns: [{ key: "sku", label: "SKU", format: "text" }, { key: "name", label: "Item", format: "text" }, { key: "stock", label: "In stock", format: "int" }, { key: "valuedQty", label: "Valued", format: "int" }, { key: "unvaluedQty", label: "No cost", format: "int" }, { key: "avgUnitCost", label: "Average", format: "money" }, { key: "value", label: "Value", format: "money" }],
      rows: arr(d.items),
      totals: [{ label: "Finished goods", value: num(obj(d.totals).finishedGoods) }, { label: "Materials", value: num(obj(d.totals).materials) }, { label: "Inventory value", value: num(obj(d.totals).value) }, { label: "Items with missing cost", value: num(obj(d.totals).incomplete), format: "int" }],
      tie: "The inventory value is the valuation side of Books health check → Inventory account = valuation.",
    }),
  },
  "cost-adjustments": {
    label: "Cost adjustments", capability: "costing.view", period: true,
    shape: (d) => ({
      columns: [{ key: "label", label: "Origin", format: "text" }, { key: "entries", label: "Postings", format: "int" }, { key: "debit", label: "Cost up", format: "money" }, { key: "credit", label: "Cost down", format: "money" }, { key: "net", label: "Net", format: "money" }],
      rows: arr(d.rows),
      totals: [{ label: `Net on ${String(obj(d.account).code ?? "")} ${String(obj(d.account).name ?? "")}`.trim(), value: num(obj(d.totals).net) }],
      tie: "The net equals the cost-adjustment account's movement for the period (reversals count under what they reverse).",
    }),
  },
  "supplier-payments": {
    label: "Supplier payments", capability: "ap.view", period: true,
    shape: (d) => ({
      columns: [{ key: "date", label: "Date", format: "text" }, { key: "supplier", label: "Supplier", format: "text" }, { key: "from", label: "Paid from", format: "text" }, { key: "reference", label: "Reference", format: "text" }, { key: "status", label: "Status", format: "text" }, { key: "amount", label: "Amount", format: "money" }, { key: "allocated", label: "Settled bills", format: "money" }, { key: "advance", label: "Advance", format: "money" }],
      rows: arr(d.items).map((i) => ({ ...i, status: String(i.status).toLowerCase().replace("_", " ") })),
      totals: [{ label: "Paid (posted)", value: num(obj(d.totals).paid) }, { label: "Payments", value: num(obj(d.totals).count), format: "int" }],
      tie: "Posted payments reduce the payables account (Books health check → Payables = supplier invoices).",
    }),
  },
};

const show = (v: unknown, f: Format) => {
  if (v === null || v === undefined || v === "") return "—";
  if (f === "money") return formatPrice(num(v));
  if (f === "pct") return `${num(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
  if (f === "int") return num(v).toLocaleString();
  return String(v);
};

/** Purchasing, payables and inventory reports (docs/FINANCE_PHASE_4G.md). Every total says which account or check it
 * agrees with; each report downloads as CSV. */
export default function FinanceReportsPage() {
  const { can, ready } = useCapabilities();
  const available = (Object.keys(REPORTS) as ReportId[]).filter((id) => can(REPORTS[id].capability));
  // ?report=<id> opens a report directly (Inventory › Stock levels links its stock value to the valuation)
  const requested = useSearchParams().get("report");
  const [chosen, setChosen] = useState<ReportId | "">(requested && requested in REPORTS ? (requested as ReportId) : "");
  const id = chosen && available.includes(chosen) ? chosen : available[0];
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");
  const def = id ? REPORTS[id] : null;
  const params = { ...(def?.period ? { from: from || undefined, to: to || undefined } : {}), ...(def?.search && search.trim() ? { q: search.trim() } : {}) };
  const q = useQuery({ queryKey: ["purchasing", "reports", id, params], queryFn: () => purchasingApi.getPurchasingReport(id!, params), enabled: Boolean(id) && !(from && to && from > to) });

  if (ready && !available.length) {
    return (
      <div>
        <ModuleTabs />
        <PermissionState icon={BarChart3} page="Reports" />
      </div>
    );
  }
  const shaped = q.data && def ? def.shape(q.data) : null;
  return (
    <div className="space-y-6">
      <ModuleTabs />
      <PageHeader title="Purchasing reports" description="Purchasing, payables and inventory — every total agrees with the books." />
      <div className="flex flex-wrap items-end gap-3">
        <Field htmlFor="report" label="Report" className="w-full sm:w-64">
          <Select id="report" value={id ?? ""} onChange={(e) => setChosen(e.target.value as ReportId)} data-testid="report-select">
            {available.map((r) => <option key={r} value={r}>{REPORTS[r].label}</option>)}
          </Select>
        </Field>
        {def?.period && (
          <>
            <Field htmlFor="from" label="From" className="w-[calc(50%-6px)] sm:w-44"><Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
            <Field htmlFor="to" label="To" className="w-[calc(50%-6px)] sm:w-44" error={from && to && from > to ? "Before From" : undefined}><Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          </>
        )}
        {def?.search && <Field htmlFor="search" label="SKU or item" className="w-full sm:w-56"><Input id="search" value={search} onChange={(e) => setSearch(e.target.value)} /></Field>}
        {shaped && shaped.rows.length > 0 && (
          <Button size="sm" variant="outline" onClick={() => downloadCsv(`${id}${from ? `-${from}` : ""}${to ? `-${to}` : ""}.csv`, toCsv(shaped.columns, shaped.rows))} data-testid="report-csv">
            <Download className="h-4 w-4" /> CSV
          </Button>
        )}
      </div>

      {q.isLoading && <Skeleton className="h-64 w-full" />}
      {q.isError && <Alert variant="danger" title="The report couldn't be loaded" action={<Button size="sm" variant="outline" onClick={() => q.refetch()}>Retry</Button>}>{getErrorMessage(q.error, "")}</Alert>}
      {shaped && (
        <>
          <dl className="grid grid-cols-2 gap-4 lg:grid-cols-4" data-testid="report-totals">
            {shaped.totals.map((t) => (
              <Card key={t.label} className="p-4">
                <dt className="text-sm text-ink-600">{t.label}</dt>
                <dd className="text-lg font-semibold tabular-nums text-ink-900">{show(t.value, t.format ?? "money")}</dd>
              </Card>
            ))}
          </dl>
          <p className="text-xs text-ink-500">{shaped.tie}</p>
          {shaped.rows.length ? (
            <Card className="overflow-hidden p-0">
              <HScrollShadow>
                <Table>
                  <TableHead>
                    <tr>{shaped.columns.map((c) => <TableHeaderCell key={c.key} align={c.format === "text" ? undefined : "right"}>{c.label}</TableHeaderCell>)}</tr>
                  </TableHead>
                  <tbody>
                    {shaped.rows.map((r, i) => (
                      <TableRow key={i} data-testid="report-row">
                        {shaped.columns.map((c) => <TableCell key={c.key} align={c.format === "text" ? undefined : "right"} className={c.format === "text" ? (c.key === "name" || c.key === "label" ? "min-w-48" : "whitespace-nowrap") : "whitespace-nowrap tabular-nums"}>{show(r[c.key], c.format)}</TableCell>)}
                      </TableRow>
                    ))}
                  </tbody>
                </Table>
              </HScrollShadow>
            </Card>
          ) : (
            <EmptyState icon={BarChart3} title="Nothing in this report" description={def?.period ? "Try a wider period." : "Nothing to show yet."} />
          )}
        </>
      )}
    </div>
  );
}
