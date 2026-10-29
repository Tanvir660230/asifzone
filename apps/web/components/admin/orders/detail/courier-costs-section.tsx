"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Plus, Receipt, Repeat } from "lucide-react";
import { SHIPMENT_OPERATIONAL_STATUS_LABEL, type ShipmentCreateInput } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { useCapabilities } from "@/hooks/use-capability";
import { getErrorMessage } from "@/lib/api-client";
import * as api from "@/lib/api/courier-costs";
import type { OrderShipments, Shipment } from "@/lib/api/courier-costs";
import { idempotencyKeyFor, settleIdempotencyKey } from "@/lib/idempotency";
import { formatPrice } from "@/lib/format";
import { Amount, CostFigures, FinancialStatusBadge, legTitle } from "@/components/admin/courier-costs/courier-cost-ui";
import { ShipmentCostDrawer } from "@/components/admin/courier-costs/shipment-cost-drawer";
import { DetailSection } from "./detail-section";

function LegRow({ leg, onOpen }: { leg: Shipment; onOpen: () => void }) {
  const f = leg.figures;
  return (
    <li>
      <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-surface-muted focus-visible:bg-surface-muted" data-testid="courier-cost-leg">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-medium text-fg">{legTitle(leg.type, leg.operationalStatus)}</span>
            <FinancialStatusBadge status={leg.financialStatus} />
          </div>
          <p className="truncate text-xs text-fg-muted">
            {[leg.courier, leg.consignmentId ?? leg.trackingCode, SHIPMENT_OPERATIONAL_STATUS_LABEL[leg.operationalStatus], leg.parcelOrder && leg.parcelOrder.id !== leg.order.id ? leg.parcelOrder.orderNumber : null].filter(Boolean).join(" · ")}
          </p>
          <p className="text-xs text-fg-muted">
            Charge <Amount value={leg.actualCharge} provisional={f.confirmedCharge === null} className="font-medium text-fg" />
            {f.contributionApplies && (
              <>
                {" "}· paid rider <Amount value={leg.contributionStatus === "VERIFIED" ? f.verifiedContribution : leg.contributionReported} provisional={leg.contributionStatus !== "VERIFIED"} className="font-medium text-fg" />
                {f.uncovered !== null && f.uncovered > 0 && <> · uncovered <Amount value={f.uncovered} provisional={f.provisional} className="font-medium text-warning-700" /></>}
                {f.excess !== null && f.excess > 0 && <> · excess <Amount value={f.excess} provisional={f.provisional} className="font-medium text-warning-700" /></>}
              </>
            )}
          </p>
        </div>
        <ChevronRight size={16} className="shrink-0 text-fg-subtle" aria-hidden="true" />
      </button>
    </li>
  );
}

/** Record a parcel the system can't see: the item coming back for an approved return / exchange, or a replacement sent
 * outside the courier booking. */
function AddLegDialog({ data, orderId, open, onClose }: { data: OrderShipments; orderId: string; open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const approved = data.returnRequests.filter((r) => r.status === "APPROVED");
  const options = [
    ...approved.filter((r) => !data.shipments.some((s) => s.returnRequest?.id === r.id && s.type === "RETURN")).map((r) => ({ key: `RETURN:${r.id}`, label: `Parcel coming back — ${r.type === "EXCHANGE" ? "exchange" : "return"}: ${r.reason}` })),
    ...approved.filter((r) => r.type === "EXCHANGE" && r.exchangeOrderId && !data.shipments.some((s) => s.returnRequest?.id === r.id && s.type === "REPLACEMENT")).map((r) => ({ key: `REPLACEMENT:${r.id}`, label: `Replacement sent outside the courier booking — ${r.reason}` })),
    { key: "RETURN:", label: "Another parcel coming back (no return request)" },
  ];
  const [choice, setChoice] = useState(options[0]!.key);
  const [courier, setCourier] = useState("Steadfast");
  const [consignmentId, setConsignmentId] = useState("");
  const [trackingCode, setTrackingCode] = useState("");
  const [type, requestId] = choice.split(":") as ["RETURN" | "REPLACEMENT", string];
  const input: ShipmentCreateInput = { type, courier: courier.trim() || "Steadfast", consignmentId: consignmentId.trim() || null, trackingCode: trackingCode.trim() || null, returnRequestId: requestId || null };
  const scope = `shipment-leg:${orderId}`;
  const create = useMutation({
    mutationFn: () => api.createShipmentLeg(orderId, input, idempotencyKeyFor(scope, input)),
    onSuccess: () => {
      settleIdempotencyKey(scope);
      toast.success("Parcel recorded");
      void queryClient.invalidateQueries({ queryKey: api.courierCostKeys.all });
      onClose();
    },
    onError: (e) => toast.error(getErrorMessage(e, "Couldn't record the parcel")),
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Record a parcel"
      description="For a leg the courier integration doesn't track. Its charge and what the customer paid are recorded on it afterwards."
      widthClassName="max-w-lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={create.isPending} onClick={() => create.mutate()}>Record parcel</Button>
        </div>
      }
    >
      <div className="space-y-3">
        <Field htmlFor="leg-kind" label="Which parcel">
          <Select id="leg-kind" value={choice} onChange={(e) => setChoice(e.target.value)}>
            {options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field htmlFor="leg-courier" label="Courier"><Input id="leg-courier" value={courier} onChange={(e) => setCourier(e.target.value)} /></Field>
          <Field htmlFor="leg-cid" label="Consignment id"><Input id="leg-cid" value={consignmentId} onChange={(e) => setConsignmentId(e.target.value)} /></Field>
          <Field htmlFor="leg-tracking" label="Tracking code"><Input id="leg-tracking" value={trackingCode} onChange={(e) => setTrackingCode(e.target.value)} /></Field>
        </div>
      </div>
    </Modal>
  );
}

/** Courier costs (docs/COURIER_COSTS.md): every parcel leg of this order — its delivery, anything that came back, an
 * exchange's replacement — with the actual charge, what the customer paid the rider and what's left uncovered. */
export function CourierCostsSection({ order }: { order: { id: string } }) {
  const { can } = useCapabilities();
  const allowed = can("courierCosts.view");
  const canRecord = can("courierCosts.record");
  const canVerify = can("courierCosts.verify");
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: api.courierCostKeys.order(order.id), queryFn: () => api.getOrderShipments(order.id), enabled: allowed });
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  if (!allowed) return null;

  const data = q.data;
  const open = data?.shipments.find((s) => s.id === openId) ?? null;
  const inExchange = new Set(data?.exchanges.flatMap((e) => e.shipmentIds) ?? []);
  const loose = data?.shipments.filter((s) => !inExchange.has(s.id)) ?? [];

  return (
    <DetailSection
      title="Courier costs"
      icon={Receipt}
      testId="order-courier-costs"
      actions={canRecord && data && data.shipments.length + data.returnRequests.length > 0 ? (
        <Button variant="ghost" size="sm" onClick={() => setAdding(true)}><Plus size={13} aria-hidden="true" /> Record parcel</Button>
      ) : undefined}
    >
      {q.isLoading && <div className="space-y-2"><Skeleton className="h-14 w-full" /><Skeleton className="h-14 w-full" /></div>}
      {q.isError && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-danger-700">
          <span>Courier costs couldn&apos;t be loaded: {getErrorMessage(q.error, "")}</span>
          <Button size="sm" variant="outline" onClick={() => q.refetch()}>Retry</Button>
        </div>
      )}
      {data && data.shipments.length === 0 && (
        <p className="text-sm text-fg-muted">No parcels yet. A leg appears once the order is booked with the courier or shipped with a manual carrier.</p>
      )}
      {data && data.shipments.length > 0 && (
        <div className="space-y-4">
          {data.exchanges.map((ex) => (
            <div key={ex.returnRequestId} className="space-y-3 rounded-xl border border-line-subtle p-3.5" data-testid="exchange-costs">
              <div className="flex flex-wrap items-center gap-2">
                <Repeat size={14} className="text-fg-subtle" aria-hidden="true" />
                <span className="text-sm font-medium text-fg">Exchange{ex.exchangeOrder ? ` · ${ex.exchangeOrder.orderNumber}` : ""}</span>
                <span className="text-xs text-fg-muted">{ex.operationalStatus === "EXCHANGE_COMPLETED" ? "Completed" : "In progress"}</span>
                <span className="ml-auto"><FinancialStatusBadge status={ex.summary.financialStatus} /></span>
              </div>
              <CostFigures charge={ex.summary.actualExpense} chargeLabel="Courier expense" paid={ex.summary.verifiedContribution} uncovered={ex.summary.uncovered} excess={ex.summary.excess} provisional={ex.summary.provisional} />
              {(ex.summary.provisional || ex.summary.excessAppliedWithinExchange > 0 || (ex.exchangeOrder && !ex.exchangeOrder.booked)) && (
                <p className="text-xs text-fg-muted">
                  {[
                    ex.summary.provisional ? "Some figures aren't verified yet — the expense counts confirmed charges only." : null,
                    ex.summary.excessAppliedWithinExchange > 0 ? `Excess of ${formatPrice(ex.summary.excessAppliedWithinExchange)} applied to the other leg.` : null,
                    ex.exchangeOrder && !ex.exchangeOrder.booked ? "The replacement isn't booked yet." : null,
                  ].filter(Boolean).join(" ")}
                </p>
              )}
              <ul className="divide-y divide-line-subtle overflow-hidden rounded-lg border border-line-subtle">
                {data.shipments.filter((s) => ex.shipmentIds.includes(s.id)).map((leg) => <LegRow key={leg.id} leg={leg} onOpen={() => setOpenId(leg.id)} />)}
              </ul>
            </div>
          ))}
          {loose.length > 0 && (
            <ul className="divide-y divide-line-subtle overflow-hidden rounded-xl border border-line-subtle">
              {loose.map((leg) => <LegRow key={leg.id} leg={leg} onOpen={() => setOpenId(leg.id)} />)}
            </ul>
          )}
        </div>
      )}
      {data && (
        <ShipmentCostDrawer
          shipment={open}
          events={data.events}
          isExchangeLeg={Boolean(open?.returnRequest?.type === "EXCHANGE")}
          canRecord={canRecord}
          canVerify={canVerify}
          onClose={() => setOpenId(null)}
          onChanged={() => void queryClient.invalidateQueries({ queryKey: api.courierCostKeys.order(order.id) })}
        />
      )}
      {data && adding && <AddLegDialog data={data} orderId={order.id} open onClose={() => setAdding(false)} />}
    </DetailSection>
  );
}
