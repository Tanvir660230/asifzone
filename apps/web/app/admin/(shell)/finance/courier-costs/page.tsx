"use client";

import Link from "next/link";
import { useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Truck, X } from "lucide-react";
import {
  SHIPMENT_FINANCIAL_STATUS_LABEL,
  SHIPMENT_FINANCIAL_STATUSES,
  SHIPMENT_OPERATIONAL_STATUS_LABEL,
  SHIPMENT_OPERATIONAL_STATUSES,
  SHIPMENT_TYPE_LABEL,
  SHIPMENT_TYPES,
  type ShipmentReportQuery,
} from "@clothing-brand/shared";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Pagination } from "@/components/ui/pagination";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableCell, TableContainer, TableHead, TableHeaderCell, TableMessageRow, TableRow } from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { ModuleTabs } from "@/components/admin/module-tabs";
import { PageHeader } from "@/components/admin/page-header";
import { Amount, FinancialStatusBadge, legTitle } from "@/components/admin/courier-costs/courier-cost-ui";
import { ShipmentCostDrawer } from "@/components/admin/courier-costs/shipment-cost-drawer";
import { useCapabilities } from "@/hooks/use-capability";
import { getErrorMessage } from "@/lib/api-client";
import * as api from "@/lib/api/courier-costs";
import type { Shipment } from "@/lib/api/courier-costs";
import { formatPrice, formatStoreDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PermissionState } from "@/components/admin/permission-state";

type Filters = Partial<ShipmentReportQuery>;
type Attention = NonNullable<ShipmentReportQuery["attention"]>;

const ATTENTION: Array<{ key: Attention; label: string; count: keyof api.ShipmentReport["counts"] }> = [
  { key: "missing_charge", label: "Actual charge missing", count: "missingCharge" },
  { key: "unverified_charge", label: "Charge not verified", count: "unverifiedCharge" },
  { key: "awaiting_contribution", label: "Contribution to record or verify", count: "awaitingContribution" },
  { key: "excess", label: "Excess to review", count: "excess" },
  { key: "uncovered_undecided", label: "Uncovered — not decided", count: "uncoveredUndecided" },
  { key: "receivable", label: "Receivables", count: "receivable" },
  { key: "unreconciled", label: "Returns & exchanges not reconciled", count: "unreconciled" },
  { key: "needs_review", label: "Needs review", count: "needsReview" },
];

function Figure({ label, value, sub, tone }: { label: string; value: number; sub?: React.ReactNode; tone?: "attention" }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium text-fg-subtle">{label}</p>
      <p className={cn("mt-1 text-xl font-semibold tracking-tight tabular-nums text-fg", tone === "attention" && value > 0 && "text-warning-700")}>{formatPrice(value)}</p>
      {sub && <p className="mt-0.5 text-xs text-fg-muted">{sub}</p>}
    </div>
  );
}

/** Courier costs (docs/COURIER_COSTS.md): confirmed courier expense by kind of leg, what customers paid riders on returns
 * and exchanges, what is left uncovered and who bears it — and every leg that still needs someone. */
export default function CourierCostsPage() {
  const { can, ready } = useCapabilities();
  const allowed = can("courierCosts.view");
  const canRecord = can("courierCosts.record");
  const canVerify = can("courierCosts.verify");
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<Filters>({ page: 1, pageSize: 25 });
  const [search, setSearch] = useState("");
  const [moreFilters, setMoreFilters] = useState(false);
  const [open, setOpen] = useState<{ shipmentId: string; orderId: string } | null>(null);
  const q = useQuery({ queryKey: api.courierCostKeys.report(filters), queryFn: () => api.getShipmentReport(filters), enabled: allowed, placeholderData: keepPreviousData });
  const orderLegs = useQuery({ queryKey: api.courierCostKeys.order(open?.orderId ?? ""), queryFn: () => api.getOrderShipments(open!.orderId), enabled: Boolean(open) });
  const sync = useMutation({
    mutationFn: api.syncPayouts,
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: api.courierCostKeys.all });
      const confirmed = r.checks.reduce((s, c) => s + c.confirmed, 0);
      const flagged = r.checks.reduce((s, c) => s + c.flagged, 0);
      toast.success(`${r.payouts} payout${r.payouts === 1 ? "" : "s"} checked — ${confirmed} charge${confirmed === 1 ? "" : "s"} confirmed${flagged ? `, ${flagged} flagged for review` : ""}`);
      if (r.problems.length) toast.error(`${r.problems.length} payout(s) couldn't be read`);
    },
    onError: (e) => toast.error(getErrorMessage(e, "Steadfast's payouts couldn't be read")),
  });

  const set = (patch: Filters) => setFilters((f) => ({ ...f, ...patch, page: 1 }));
  if (ready && !allowed) return <div><ModuleTabs /><PermissionState icon={Truck} page="This page" /></div>;
  const d = q.data;
  const t = d?.totals;
  const active = Object.entries(filters).some(([k, v]) => !["page", "pageSize"].includes(k) && v);
  const openLeg = orderLegs.data?.shipments.find((s) => s.id === open?.shipmentId) ?? null;

  return (
    <div className="space-y-6">
      <ModuleTabs />
      <PageHeader
        title="Courier costs"
        description="What every parcel really cost, what customers paid the rider on refusals, returns and exchanges, and what the shop is left to bear."
        action={canRecord ? (
          <Button variant="outline" size="sm" loading={sync.isPending} onClick={() => sync.mutate()}>
            <RefreshCw size={13} aria-hidden="true" /> Check Steadfast payouts
          </Button>
        ) : undefined}
      />

      <Card className="p-3 sm:p-4">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8" role="group" aria-label="Filters">
          <Input type="date" aria-label="From" value={filters.from ?? ""} onChange={(e) => set({ from: e.target.value || undefined })} />
          <Input type="date" aria-label="To" value={filters.to ?? ""} onChange={(e) => set({ to: e.target.value || undefined })} />
          {/* Phones show dates and search; the rest behind "More filters". */}
          <div className={cn("contents", !moreFilters && "max-md:hidden")}>
          <Select aria-label="Leg" value={filters.type ?? ""} onChange={(e) => set({ type: (e.target.value || undefined) as Filters["type"] })}>
            <option value="">All legs</option>
            {SHIPMENT_TYPES.map((s) => <option key={s} value={s}>{SHIPMENT_TYPE_LABEL[s]}</option>)}
          </Select>
          <Select aria-label="Courier" value={filters.courier ?? ""} onChange={(e) => set({ courier: e.target.value || undefined })}>
            <option value="">All couriers</option>
            {d?.options.couriers.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
          <Select aria-label="Zone" value={filters.zone ?? ""} onChange={(e) => set({ zone: e.target.value || undefined })}>
            <option value="">All zones</option>
            {d?.options.zones.map((z) => <option key={z} value={z}>{z}</option>)}
          </Select>
          <Select aria-label="Parcel status" value={filters.operationalStatus ?? ""} onChange={(e) => set({ operationalStatus: (e.target.value || undefined) as Filters["operationalStatus"] })}>
            <option value="">Any parcel status</option>
            {SHIPMENT_OPERATIONAL_STATUSES.map((s) => <option key={s} value={s}>{SHIPMENT_OPERATIONAL_STATUS_LABEL[s]}</option>)}
          </Select>
          <Select aria-label="Money status" value={filters.financialStatus ?? ""} onChange={(e) => set({ financialStatus: (e.target.value || undefined) as Filters["financialStatus"] })}>
            <option value="">Any money status</option>
            {SHIPMENT_FINANCIAL_STATUSES.map((s) => <option key={s} value={s}>{SHIPMENT_FINANCIAL_STATUS_LABEL[s]}</option>)}
          </Select>
          </div>
          <form className="col-span-2 md:col-span-1" onSubmit={(e) => { e.preventDefault(); set({ search: search.trim() || undefined }); }}>
            <Input type="search" aria-label="Order or consignment" placeholder="Order / consignment" value={search} onChange={(e) => setSearch(e.target.value)} />
          </form>
        </div>
        <button type="button" className="mt-2 mr-4 inline-flex items-center gap-1 text-xs font-medium text-fg-muted hover:text-fg md:hidden" aria-expanded={moreFilters} onClick={() => setMoreFilters((v) => !v)}>
          {moreFilters ? "Fewer filters" : "More filters"}
        </button>
        {active && (
          <button type="button" className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-fg-muted hover:text-fg" onClick={() => { setSearch(""); setFilters({ page: 1, pageSize: 25 }); }}>
            <X size={12} aria-hidden="true" /> Clear filters
          </button>
        )}
      </Card>

      {q.isLoading && <Skeleton className="h-48 w-full" />}
      {q.isError && <Alert variant="danger" title="Courier costs couldn't be loaded" action={<Button size="sm" variant="outline" onClick={() => q.refetch()}>Retry</Button>}>{getErrorMessage(q.error, "")}</Alert>}

      {d && t && (
        <>
          <Card className="space-y-5 p-4 sm:p-5" aria-label="Summary">
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
              <Figure label="Confirmed courier expense" value={t.confirmedExpense} sub={<>Deliveries {formatPrice(t.deliveries)} · refusals & returns {formatPrice(t.returns)} · exchanges {formatPrice(t.exchanges)}</>} />
              <Figure label="Customers paid riders (verified)" value={t.verifiedContribution} sub={<>Reported {formatPrice(t.reportedContribution)} — paid to the courier, not the shop</>} />
              <Figure label="Uncovered courier cost" value={t.uncovered} tone="attention" sub={<>Business bears {formatPrice(t.absorbed)} · receivable {formatPrice(t.receivable)} · not decided {formatPrice(t.undecidedUncovered)}</>} />
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-1 border-t border-line-subtle pt-3 text-xs text-fg-muted">
              <span>Excess awaiting review <span className="font-medium tabular-nums text-fg">{formatPrice(t.excessAwaitingReview)}</span></span>
              <span>Charges entered, not verified <span className="font-medium tabular-nums text-fg">{formatPrice(t.unconfirmedCharges)}</span> (not counted above)</span>
              {t.provisionalUncovered > 0 && <span>Uncovered on unverified figures <span className="font-medium tabular-nums text-fg">{formatPrice(t.provisionalUncovered)}</span></span>}
              <span>{d.counts.total} leg{d.counts.total === 1 ? "" : "s"}</span>
            </div>
          </Card>

          <section aria-label="Needs attention" className="flex flex-wrap gap-2">
            {ATTENTION.map((a) => {
              const n = d.counts[a.count];
              const on = filters.attention === a.key;
              return (
                <button
                  key={a.key}
                  type="button"
                  aria-pressed={on}
                  disabled={!n && !on}
                  onClick={() => set({ attention: on ? undefined : a.key })}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-40",
                    on ? "border-accent bg-accent text-accent-fg" : "border-line bg-surface text-fg hover:border-ink-400",
                  )}
                >
                  {a.label}
                  <span className={cn("tabular-nums", on ? "text-accent-fg/80" : "text-fg-subtle")}>{n}</span>
                </button>
              );
            })}
          </section>

          {/* Phones: a list of cards. */}
          <ul className="space-y-2 sm:hidden" aria-label="Shipment legs">
            {d.items.length === 0 && <li className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-fg-muted">No legs match these filters.</li>}
            {d.items.map((s) => (
              <li key={s.id}>
                <button type="button" onClick={() => setOpen({ shipmentId: s.id, orderId: s.order.id })} className="w-full space-y-1.5 rounded-xl border border-line-subtle bg-surface p-3 text-left">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-medium text-fg">{s.order.orderNumber}</span>
                    <FinancialStatusBadge status={s.financialStatus} />
                  </div>
                  <p className="text-xs text-fg-muted">{legTitle(s.type, s.operationalStatus)} · {s.courier}{s.consignmentId ? ` · ${s.consignmentId}` : ""}</p>
                  <p className="text-xs text-fg-muted">
                    Charge <Amount value={s.actualCharge} provisional={s.figures.confirmedCharge === null} className="font-medium text-fg" />
                    {s.figures.contributionApplies && <> · uncovered <Amount value={s.figures.uncovered} provisional={s.figures.provisional} className="font-medium text-fg" /></>}
                  </p>
                </button>
              </li>
            ))}
          </ul>

          {/* Wider screens: the table. */}
          <TableContainer className="hidden sm:block">
            <Table>
              <TableHead>
                <tr>
                  <TableHeaderCell>Order</TableHeaderCell>
                  <TableHeaderCell>Leg</TableHeaderCell>
                  <TableHeaderCell>Zone</TableHeaderCell>
                  <TableHeaderCell align="right">Actual charge</TableHeaderCell>
                  <TableHeaderCell align="right">Paid rider</TableHeaderCell>
                  <TableHeaderCell align="right">Uncovered</TableHeaderCell>
                  <TableHeaderCell>Money status</TableHeaderCell>
                </tr>
              </TableHead>
              <tbody>
                {d.items.length === 0 && <TableMessageRow colSpan={7}>No legs match these filters.</TableMessageRow>}
                {d.items.map((s: Shipment) => (
                  <TableRow key={s.id} interactive onClick={() => setOpen({ shipmentId: s.id, orderId: s.order.id })}>
                    <TableCell>
                      <Link href={`/admin/orders/${s.order.id}`} onClick={(e) => e.stopPropagation()} className="font-medium text-fg hover:underline">{s.order.orderNumber}</Link>
                      <p className="text-xs text-fg-subtle">{s.completedAt ? formatStoreDateTime(s.completedAt) : "In progress"}</p>
                    </TableCell>
                    <TableCell>
                      <p className="text-sm text-fg">{legTitle(s.type, s.operationalStatus)}</p>
                      <p className="text-xs text-fg-subtle">{[s.courier, s.consignmentId, SHIPMENT_OPERATIONAL_STATUS_LABEL[s.operationalStatus]].filter(Boolean).join(" · ")}</p>
                    </TableCell>
                    <TableCell className="text-sm text-fg-muted">{s.deliveryZone ?? "—"}</TableCell>
                    <TableCell align="right"><Amount value={s.actualCharge} provisional={s.figures.confirmedCharge === null} /></TableCell>
                    <TableCell align="right">{s.figures.contributionApplies ? <Amount value={s.contributionStatus === "VERIFIED" ? s.figures.verifiedContribution : s.contributionReported} provisional={s.contributionStatus !== "VERIFIED"} /> : <span className="text-xs text-fg-subtle">n/a</span>}</TableCell>
                    <TableCell align="right">{s.figures.contributionApplies ? <Amount value={s.figures.uncovered} provisional={s.figures.provisional} /> : <span className="text-xs text-fg-subtle">n/a</span>}</TableCell>
                    <TableCell><FinancialStatusBadge status={s.financialStatus} /></TableCell>
                  </TableRow>
                ))}
              </tbody>
            </Table>
          </TableContainer>
          <Pagination page={d.page} totalPages={Math.ceil(d.total / d.pageSize)} onChange={(page) => setFilters((f) => ({ ...f, page }))} />
          <p className="text-xs text-fg-muted">
            Grey amounts aren&apos;t verified yet and never count as confirmed expense. Customer contributions went to the courier&apos;s rider — they are not sales or cash received. Steadfast reports charges per payout only; &ldquo;Check Steadfast payouts&rdquo; confirms charges where a payout&apos;s total proves them.
          </p>
        </>
      )}

      {open && openLeg && orderLegs.data && (
        <ShipmentCostDrawer
          shipment={openLeg}
          events={orderLegs.data.events}
          isExchangeLeg={openLeg.returnRequest?.type === "EXCHANGE"}
          canRecord={canRecord}
          canVerify={canVerify}
          onClose={() => setOpen(null)}
          onChanged={() => void queryClient.invalidateQueries({ queryKey: api.courierCostKeys.all })}
        />
      )}
    </div>
  );
}
