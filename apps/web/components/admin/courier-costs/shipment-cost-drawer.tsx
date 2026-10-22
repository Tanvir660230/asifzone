"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, History, RefreshCw, RotateCcw } from "lucide-react";
import {
  CHARGE_SOURCE_LABEL,
  CHARGE_STATUS_LABEL,
  CHARGE_SOURCES,
  CONTRIBUTION_SOURCE_LABEL,
  CONTRIBUTION_SOURCES,
  CONTRIBUTION_STATUS_LABEL,
  EXCESS_TREATMENT_LABEL,
  EXCESS_TREATMENTS,
  SHIPMENT_FINANCIAL_STATUS_LABEL,
  SHIPMENT_OPERATIONAL_STATUS_LABEL,
  SHIPMENT_OPERATIONAL_STATUSES,
  UNCOVERED_TREATMENT_LABEL,
  UNCOVERED_TREATMENTS,
  contributionApplies,
  courierCostFigures,
  reconcileBlocker,
  type ChargeStatus,
  type ContributionStatus,
  type ExcessTreatment,
  type ShipmentCostUpdateInput,
  type ShipmentOperationalStatus,
  type UncoveredTreatment,
} from "@clothing-brand/shared";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { ApiError, getErrorMessage } from "@/lib/api-client";
import * as api from "@/lib/api/courier-costs";
import type { Shipment, ShipmentEvent } from "@/lib/api/courier-costs";
import { formatPrice, formatStoreDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CostFigures, FinancialStatusBadge, legTitle } from "./courier-cost-ui";

interface FormState {
  operationalStatus: ShipmentOperationalStatus;
  actualCharge: string;
  chargeStatus: ChargeStatus;
  chargeSource: string;
  chargeReference: string;
  quotedCharge: string;
  weightKg: string;
  contributionReported: string;
  contributionVerified: string;
  contributionStatus: ContributionStatus;
  contributionSource: string;
  contributionReference: string;
  uncoveredTreatment: UncoveredTreatment;
  excessTreatment: ExcessTreatment;
  note: string;
  reason: string;
}

const str = (v: number | null) => (v === null ? "" : String(v));
function formOf(s: Shipment): FormState {
  return {
    operationalStatus: s.operationalStatus,
    actualCharge: str(s.actualCharge),
    chargeStatus: s.chargeStatus,
    chargeSource: s.chargeSource ?? "",
    chargeReference: s.chargeReference ?? "",
    quotedCharge: str(s.quotedCharge),
    weightKg: str(s.weightKg),
    contributionReported: str(s.contributionReported),
    contributionVerified: str(s.contributionVerified),
    contributionStatus: s.contributionStatus,
    contributionSource: s.contributionSource ?? "",
    contributionReference: s.contributionReference ?? "",
    uncoveredTreatment: s.uncoveredTreatment,
    excessTreatment: s.excessTreatment,
    note: s.note ?? "",
    reason: "",
  };
}

/** "" → null; anything else a number (NaN stays NaN so validation can flag it). */
const money = (v: string): number | null => (v.trim() === "" ? null : Number(v));
const minor = (v: string) => {
  const n = money(v);
  return n === null || !Number.isFinite(n) || n < 0 ? null : Math.round(n * 100);
};
const invalidMoney = (v: string) => v.trim() !== "" && (!Number.isFinite(Number(v)) || Number(v) < 0 || Math.abs(Math.round(Number(v) * 100) - Number(v) * 100) > 1e-6);

/** Only what changed is sent — so a staff save never touches (and never needs permission for) a verified figure. */
function payloadOf(s: Shipment, f: FormState): ShipmentCostUpdateInput {
  const p: Record<string, unknown> = { version: s.version };
  const o = formOf(s);
  if (f.operationalStatus !== o.operationalStatus) p.operationalStatus = f.operationalStatus;
  const chargeChanged = f.actualCharge !== o.actualCharge;
  if (chargeChanged) p.actualCharge = money(f.actualCharge);
  if (f.chargeStatus !== o.chargeStatus || chargeChanged) {
    // "Confirmed by courier" is never set by hand: an edited amount goes back to entered unless marked verified.
    p.chargeStatus = f.chargeStatus === "COURIER_CONFIRMED" || f.chargeStatus === "MISSING" ? "ENTERED" : f.chargeStatus;
    if (money(f.actualCharge) === null) p.chargeStatus = "MISSING";
  }
  if (f.chargeSource !== o.chargeSource) p.chargeSource = f.chargeSource || null;
  if (f.chargeReference !== o.chargeReference) p.chargeReference = f.chargeReference || null;
  if (f.quotedCharge !== o.quotedCharge) p.quotedCharge = money(f.quotedCharge);
  if (f.weightKg !== o.weightKg) p.weightKg = money(f.weightKg);
  if (f.contributionReported !== o.contributionReported) p.contributionReported = money(f.contributionReported);
  if (f.contributionStatus !== o.contributionStatus) p.contributionStatus = f.contributionStatus;
  if (f.contributionVerified !== o.contributionVerified || (f.contributionStatus === "VERIFIED" && f.contributionStatus !== o.contributionStatus)) {
    // Left empty, the verified amount is the reported one (the field shows it as its placeholder).
    p.contributionVerified = f.contributionStatus === "VERIFIED" ? (money(f.contributionVerified) ?? money(f.contributionReported)) : null;
  }
  if (f.contributionSource !== o.contributionSource) p.contributionSource = f.contributionSource || null;
  if (f.contributionReference !== o.contributionReference) p.contributionReference = f.contributionReference || null;
  if (f.uncoveredTreatment !== o.uncoveredTreatment) p.uncoveredTreatment = f.uncoveredTreatment;
  if (f.excessTreatment !== o.excessTreatment) p.excessTreatment = f.excessTreatment;
  if (f.note !== o.note) p.note = f.note || null;
  if (f.reason.trim()) p.reason = f.reason.trim();
  return p as ShipmentCostUpdateInput;
}

const FIELD_LABEL: Record<string, string> = {
  actualCharge: "Actual charge",
  chargeStatus: "Charge",
  chargeSource: "Charge source",
  chargeReference: "Charge reference",
  quotedCharge: "Quoted charge",
  weightKg: "Weight (kg)",
  contributionReported: "Reported paid to rider",
  contributionVerified: "Verified paid to rider",
  contributionStatus: "Contribution",
  contributionSource: "Contribution source",
  contributionReference: "Contribution reference",
  uncoveredTreatment: "Uncovered cost",
  excessTreatment: "Excess",
  operationalStatus: "Parcel",
  reconciled: "Reconciled",
  reviewReason: "Review flag",
  courierPayoutRef: "Courier payout",
  bookedCodAmount: "Booked COD",
  courierCollected: "Courier collected",
  note: "Note",
};
const MONEY_FIELDS = new Set(["actualCharge", "quotedCharge", "contributionReported", "contributionVerified", "bookedCodAmount", "courierCollected"]);
const ACTION_LABEL: Record<string, string> = {
  CREATED: "Recorded",
  SYNCED: "Updated from the courier",
  UPDATED: "Edited",
  RECONCILED: "Reconciled",
  REOPENED: "Reopened",
  COURIER_CONFIRMED: "Confirmed by the courier's payout",
  REVIEW_FLAGGED: "Flagged for review",
  REVIEW_CLEARED: "Review cleared",
};
function showValue(key: string, v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (MONEY_FIELDS.has(key) && typeof v === "number") return formatPrice(v);
  if (key === "chargeStatus") return CHARGE_STATUS_LABEL[v as ChargeStatus] ?? String(v);
  if (key === "contributionStatus") return CONTRIBUTION_STATUS_LABEL[v as ContributionStatus] ?? String(v);
  if (key === "uncoveredTreatment") return UNCOVERED_TREATMENT_LABEL[v as UncoveredTreatment] ?? String(v);
  if (key === "excessTreatment") return EXCESS_TREATMENT_LABEL[v as ExcessTreatment] ?? String(v);
  if (key === "operationalStatus") return SHIPMENT_OPERATIONAL_STATUS_LABEL[v as ShipmentOperationalStatus] ?? String(v);
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}

function HistoryList({ events }: { events: ShipmentEvent[] }) {
  if (!events.length) return <p className="text-sm text-fg-muted">No changes recorded yet.</p>;
  return (
    <ol className="space-y-3">
      {events.map((e) => {
        const changes = Object.entries(e.changes ?? {}).filter(([k]) => k in FIELD_LABEL);
        return (
          <li key={e.id} className="rounded-lg border border-line-subtle p-3 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <span className="font-medium text-fg">{ACTION_LABEL[e.action] ?? e.action}</span>
              <span className="text-xs text-fg-subtle">{e.admin?.name ?? "System"} · {formatStoreDateTime(e.createdAt)}</span>
            </div>
            {changes.length > 0 && (
              <ul className="mt-1.5 space-y-0.5 text-xs text-fg-muted">
                {changes.map(([k, c]) => (
                  <li key={k}>
                    {FIELD_LABEL[k]}: <span className="tabular-nums">{showValue(k, c.from)}</span> → <span className="tabular-nums font-medium text-fg">{showValue(k, c.to)}</span>
                  </li>
                ))}
              </ul>
            )}
            {e.reason && <p className="mt-1.5 text-xs text-fg"><span className="text-fg-subtle">Reason:</span> {e.reason}</p>}
            {e.note && <p className="mt-1 text-xs text-fg-muted">{e.note}</p>}
            {(e.source || e.reference) && <p className="mt-1 text-[11px] text-fg-subtle">{[e.source, e.reference].filter(Boolean).join(" · ")}</p>}
          </li>
        );
      })}
    </ol>
  );
}

function SectionTitle({ children, hint }: { children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="mb-3">
      <h3 className="text-[13px] font-semibold uppercase tracking-wider text-fg-subtle">{children}</h3>
      {hint && <p className="mt-1 text-xs text-fg-muted">{hint}</p>}
    </div>
  );
}

/** One leg's money record: the courier's actual charge, what the customer paid the rider, and who bears a difference —
 * with a live preview computed by the same rules the server saves with. */
export function ShipmentCostDrawer({
  shipment,
  events,
  isExchangeLeg,
  canRecord,
  canVerify,
  onClose,
  onChanged,
}: {
  shipment: Shipment | null;
  events: ShipmentEvent[];
  isExchangeLeg: boolean;
  canRecord: boolean;
  canVerify: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState | null>(shipment ? formOf(shipment) : null);
  const [reviewNote, setReviewNote] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [reopenReason, setReopenReason] = useState<string | null>(null);
  useEffect(() => {
    setForm(shipment ? formOf(shipment) : null);
    setReviewNote("");
    setReopenReason(null);
  }, [shipment?.id, shipment?.version]); // eslint-disable-line react-hooks/exhaustive-deps

  const done = (message: string) => {
    toast.success(message);
    void queryClient.invalidateQueries({ queryKey: api.courierCostKeys.all });
    onChanged();
  };
  const failed = (e: unknown, fallback: string) => {
    const code = e instanceof ApiError ? (e.details as { code?: string } | undefined)?.code : undefined;
    if (code === "SHIPMENT_STALE") {
      toast.error("Someone changed this record meanwhile — showing the latest. Re-enter your change.");
      onChanged();
      return;
    }
    toast.error(getErrorMessage(e, fallback));
  };

  const save = useMutation({ mutationFn: (p: ShipmentCostUpdateInput) => api.updateShipmentCosts(shipment!.id, p), onSuccess: () => done("Saved"), onError: (e) => failed(e, "Couldn't save") });
  const reconcile = useMutation({ mutationFn: () => api.reconcileShipment(shipment!.id, { version: shipment!.version, note: form?.note || null }), onSuccess: () => done("Reconciled"), onError: (e) => failed(e, "Couldn't reconcile") });
  const reopen = useMutation({ mutationFn: (reason: string) => api.reopenShipment(shipment!.id, { version: shipment!.version, reason }), onSuccess: () => done("Reopened"), onError: (e) => failed(e, "Couldn't reopen") });
  const clearReview = useMutation({ mutationFn: () => api.clearShipmentReview(shipment!.id, { version: shipment!.version, note: reviewNote }), onSuccess: () => done("Review cleared"), onError: (e) => failed(e, "Couldn't clear the review") });
  const refresh = useMutation({
    mutationFn: () => api.refreshShipment(shipment!.id),
    onSuccess: (r) => {
      for (const m of r.messages) toast.info(m);
      void queryClient.invalidateQueries({ queryKey: api.courierCostKeys.all });
      onChanged();
    },
    onError: (e) => toast.error(getErrorMessage(e, "The courier couldn't be reached")),
  });

  const preview = useMemo(() => {
    if (!shipment || !form) return null;
    const input = {
      type: shipment.type,
      operationalStatus: form.operationalStatus,
      actualCharge: minor(form.actualCharge),
      chargeStatus: minor(form.actualCharge) === null ? ("MISSING" as const) : form.chargeStatus === "MISSING" ? ("ENTERED" as const) : form.chargeStatus,
      contributionReported: minor(form.contributionReported),
      contributionVerified: form.contributionStatus === "VERIFIED" ? (minor(form.contributionVerified) ?? minor(form.contributionReported)) : null,
      contributionStatus: form.contributionStatus,
      uncoveredTreatment: form.uncoveredTreatment,
      excessTreatment: form.excessTreatment,
      reconciled: Boolean(shipment.reconciledAt),
      reviewReason: shipment.reviewReason,
    };
    return { figures: courierCostFigures(input), blocker: reconcileBlocker(input) };
  }, [shipment, form]);

  if (!shipment || !form || !preview) return null;

  const f = form;
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm({ ...f, [k]: v });
  const payload = payloadOf(shipment, f);
  const dirty = Object.keys(payload).some((k) => k !== "version" && k !== "reason");
  const applies = contributionApplies(shipment.type, f.operationalStatus);
  const editable = canRecord;
  const chargeConfirmed = shipment.chargeStatus === "VERIFIED" || shipment.chargeStatus === "COURIER_CONFIRMED";
  const contributionSettled = shipment.contributionStatus === "VERIFIED" || shipment.contributionStatus === "UNVERIFIED";
  const reasonLikely =
    Boolean(shipment.reconciledAt) ||
    (chargeConfirmed && ("actualCharge" in payload || "chargeStatus" in payload)) ||
    (contributionSettled && ("contributionStatus" in payload || "contributionVerified" in payload)) ||
    (shipment.uncoveredTreatment !== "UNDECIDED" && "uncoveredTreatment" in payload) ||
    (shipment.excessTreatment !== "UNDECIDED" && "excessTreatment" in payload);
  const errors = {
    actualCharge: invalidMoney(f.actualCharge) ? "Enter an amount like 120 or 120.50" : f.chargeStatus === "VERIFIED" && money(f.actualCharge) === null ? "Enter the charge you are verifying" : undefined,
    quotedCharge: invalidMoney(f.quotedCharge) ? "Enter an amount" : undefined,
    contributionReported: invalidMoney(f.contributionReported) ? "Enter an amount (0 if nothing)" : (f.contributionStatus === "REPORTED" || f.contributionStatus === "UNVERIFIED") && money(f.contributionReported) === null ? "Enter what the customer says they paid (0 if nothing)" : undefined,
    contributionVerified: invalidMoney(f.contributionVerified) ? "Enter an amount" : f.contributionStatus === "VERIFIED" && money(f.contributionVerified) === null && money(f.contributionReported) === null ? "Enter the verified amount (0 if nothing)" : undefined,
    weightKg: f.weightKg.trim() !== "" && !(Number(f.weightKg) >= 0) ? "Enter a weight in kg" : undefined,
    reason: reasonLikely && dirty && !f.reason.trim() ? "Say why — this changes a verified figure or a reconciled record" : undefined,
  };
  const hasErrors = Object.values(errors).some(Boolean);
  const pending = save.isPending || reconcile.isPending || reopen.isPending || clearReview.isPending;
  const p = preview.figures;
  const major = (v: number | null) => (v === null ? null : v / 100);
  const opEditable = editable && !shipment.trackedByCourier;
  const steadfast = shipment.courier.toLowerCase() === "steadfast" && Boolean(shipment.consignmentId);
  const legEvents = events.filter((e) => e.shipmentId === shipment.id);

  return (
    <Drawer open onClose={onClose} title={`${legTitle(shipment.type, f.operationalStatus)}${shipment.consignmentId ? ` · ${shipment.consignmentId}` : ""}`} widthClassName="max-w-2xl">
      <form
        className="flex min-h-full flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          if (dirty && !hasErrors) save.mutate(payload);
        }}
        noValidate
      >
        <div className="flex-1 space-y-6 px-5 py-5">
          {/* At a glance — recalculated as you type, with the same rules the server saves with. */}
          <section aria-label="Position" className="space-y-3 rounded-xl border border-line-subtle bg-surface-muted p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <FinancialStatusBadge status={dirty ? p.financialStatus : shipment.financialStatus} />
              {p.provisional && <span className="text-xs text-fg-muted">Figures in grey aren&apos;t verified yet</span>}
            </div>
            <CostFigures
              charge={major(minor(f.actualCharge))}
              paid={p.contributionApplies && f.contributionStatus !== "NOT_RECORDED" ? major(f.contributionStatus === "VERIFIED" ? p.verifiedContribution : p.reportedContribution) : null}
              uncovered={major(p.uncovered)}
              excess={major(p.excess)}
              provisional={p.provisional}
              chargeProvisional={p.confirmedCharge === null}
              paidProvisional={f.contributionStatus !== "VERIFIED"}
            />
            {!p.contributionApplies && <p className="text-xs text-fg-muted">A normal delivery: the customer paid for shipping in the order, so nothing is collected toward the courier here.</p>}
          </section>

          {shipment.reviewReason && (
            <Alert variant="danger" title="Needs review">
              <p>{shipment.reviewReason}</p>
              {canVerify && (
                <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                  <Input aria-label="What you found" placeholder="What you found (e.g. surcharge billed separately)" value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} />
                  <Button type="button" size="sm" variant="outline" disabled={reviewNote.trim().length < 3} loading={clearReview.isPending} onClick={() => clearReview.mutate()}>
                    Mark reviewed
                  </Button>
                </div>
              )}
            </Alert>
          )}

          <section>
            <SectionTitle hint={shipment.trackedByCourier ? "Steadfast reports this parcel's progress — change the order's status if it's wrong." : "Not tracked by a courier integration — keep the status up to date here."}>Parcel</SectionTitle>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field htmlFor="cc-op" label="Status">
                <Select id="cc-op" value={f.operationalStatus} disabled={!opEditable} onChange={(e) => set("operationalStatus", e.target.value as ShipmentOperationalStatus)}>
                  {SHIPMENT_OPERATIONAL_STATUSES.map((s) => <option key={s} value={s}>{SHIPMENT_OPERATIONAL_STATUS_LABEL[s]}</option>)}
                </Select>
              </Field>
              <Field htmlFor="cc-weight" label="Weight (kg)" hint="Steadfast's API doesn't report weight." error={errors.weightKg}>
                <Input id="cc-weight" inputMode="decimal" value={f.weightKg} disabled={!editable} onChange={(e) => set("weightKg", e.target.value)} />
              </Field>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
              <div><dt className="text-[11px] text-fg-subtle">Courier</dt><dd className="text-fg">{shipment.courier}</dd></div>
              <div><dt className="text-[11px] text-fg-subtle">Zone</dt><dd className="text-fg">{shipment.deliveryZone ?? "—"}</dd></div>
              <div><dt className="text-[11px] text-fg-subtle">Courier says</dt><dd className="text-fg">{shipment.courierStatus ?? "—"}</dd></div>
              <div><dt className="text-[11px] text-fg-subtle">Booked COD</dt><dd className="tabular-nums text-fg">{shipment.bookedCodAmount === null ? "—" : formatPrice(shipment.bookedCodAmount)}</dd></div>
              <div><dt className="text-[11px] text-fg-subtle">Payout</dt><dd className="text-fg">{shipment.courierPayoutRef ?? "Not paid out yet"}</dd></div>
              <div><dt className="text-[11px] text-fg-subtle">Courier collected</dt><dd className="tabular-nums text-fg">{shipment.courierCollected === null ? "—" : formatPrice(shipment.courierCollected)}</dd></div>
            </dl>
            {steadfast && canRecord && (
              <Button type="button" variant="outline" size="sm" className="mt-3" loading={refresh.isPending} onClick={() => refresh.mutate()}>
                <RefreshCw size={13} aria-hidden="true" /> Retrieve from Steadfast
              </Button>
            )}
          </section>

          <section>
            <SectionTitle hint="What the courier actually charged for this leg. Steadfast reports charges per payout, not per parcel — a payout whose total matches confirms them.">Courier charge</SectionTitle>
            <p className="mb-3 text-xs text-fg-muted">
              Standard {shipment.standardCharge === null ? "—" : formatPrice(shipment.standardCharge)}
              {shipment.standardChargeSource === "RATE_CARD" ? " (rate card)" : shipment.standardChargeSource === "SETTINGS" ? " (Settings)" : ""} · estimate for this outcome{" "}
              {shipment.estimatedCharge === null ? "—" : formatPrice(shipment.estimatedCharge)} — reference only, never counted as the actual.
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field htmlFor="cc-actual" label="Actual charge" error={errors.actualCharge}>
                <Input id="cc-actual" inputMode="decimal" value={f.actualCharge} disabled={!editable || (chargeConfirmed && !canVerify)} onChange={(e) => {
                    const v = e.target.value;
                    // The status follows the amount: typing one makes it "entered", clearing it makes it "not known".
                    const chargeStatus = v.trim() === "" ? "MISSING" : f.chargeStatus === "MISSING" ? "ENTERED" : f.chargeStatus;
                    setForm({ ...f, actualCharge: v, chargeStatus });
                  }} />
              </Field>
              <Field htmlFor="cc-charge-status" label="Charge is" hint={shipment.chargeVerifiedBy ? `Verified by ${shipment.chargeVerifiedBy.name}${shipment.chargeVerifiedAt ? `, ${formatStoreDateTime(shipment.chargeVerifiedAt)}` : ""}` : undefined}>
                <Select id="cc-charge-status" value={f.chargeStatus} disabled={!editable || (chargeConfirmed && !canVerify)} onChange={(e) => set("chargeStatus", e.target.value as ChargeStatus)}>
                  <option value="MISSING">{CHARGE_STATUS_LABEL.MISSING}</option>
                  <option value="ENTERED">{CHARGE_STATUS_LABEL.ENTERED}</option>
                  <option value="VERIFIED" disabled={!canVerify}>{CHARGE_STATUS_LABEL.VERIFIED}{canVerify ? "" : " (owner / finance)"}</option>
                  {shipment.chargeStatus === "COURIER_CONFIRMED" && <option value="COURIER_CONFIRMED" disabled>{CHARGE_STATUS_LABEL.COURIER_CONFIRMED}</option>}
                </Select>
              </Field>
              <Field htmlFor="cc-charge-source" label="Where it comes from">
                <Select id="cc-charge-source" value={f.chargeSource} disabled={!editable} onChange={(e) => set("chargeSource", e.target.value)}>
                  <option value="">—</option>
                  {CHARGE_SOURCES.map((s) => <option key={s} value={s}>{CHARGE_SOURCE_LABEL[s]}</option>)}
                </Select>
              </Field>
              <Field htmlFor="cc-charge-ref" label="Reference">
                <Input id="cc-charge-ref" placeholder="Invoice no., payout id…" value={f.chargeReference} disabled={!editable} onChange={(e) => set("chargeReference", e.target.value)} />
              </Field>
              <Field htmlFor="cc-quoted" label="Quoted by the courier" hint="Optional — a quote is never treated as the final charge." error={errors.quotedCharge}>
                <Input id="cc-quoted" inputMode="decimal" value={f.quotedCharge} disabled={!editable} onChange={(e) => set("quotedCharge", e.target.value)} />
              </Field>
            </div>
          </section>

          {applies && (
            <section>
              <SectionTitle hint="Money the customer handed the delivery person toward the courier charge. It went to the courier, not the shop — it is never recorded as a sale or cash received.">
                Customer paid the rider
              </SectionTitle>
              {shipment.courierCollected !== null && shipment.courierCollected > 0 && canVerify && f.contributionStatus !== "VERIFIED" && (
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-info-50 px-3 py-2 text-xs text-info-800">
                  <span>Steadfast&apos;s payout {shipment.courierPayoutRef} shows {formatPrice(shipment.courierCollected)} collected on this parcel.</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setForm({ ...f, contributionStatus: "VERIFIED", contributionVerified: String(shipment.courierCollected), contributionSource: "COURIER_PAYOUT", contributionReference: shipment.courierPayoutRef ?? "" })}
                  >
                    Use as verified
                  </Button>
                </div>
              )}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field htmlFor="cc-reported" label="Amount reported" hint="0 if the customer paid nothing." error={errors.contributionReported}>
                  <Input id="cc-reported" inputMode="decimal" value={f.contributionReported} disabled={!editable} onChange={(e) => setForm({ ...f, contributionReported: e.target.value, contributionStatus: f.contributionStatus === "NOT_RECORDED" && e.target.value.trim() !== "" ? "REPORTED" : f.contributionStatus })} />
                </Field>
                <Field htmlFor="cc-contribution-status" label="Contribution is" hint={shipment.contributionVerifiedBy ? `Verified by ${shipment.contributionVerifiedBy.name}` : undefined}>
                  <Select id="cc-contribution-status" value={f.contributionStatus} disabled={!editable} onChange={(e) => set("contributionStatus", e.target.value as ContributionStatus)}>
                    <option value="NOT_RECORDED">{CONTRIBUTION_STATUS_LABEL.NOT_RECORDED}</option>
                    <option value="REPORTED">{CONTRIBUTION_STATUS_LABEL.REPORTED}</option>
                    <option value="VERIFIED" disabled={!canVerify}>{CONTRIBUTION_STATUS_LABEL.VERIFIED}{canVerify ? "" : " (owner / finance)"}</option>
                    <option value="UNVERIFIED" disabled={!canVerify}>{CONTRIBUTION_STATUS_LABEL.UNVERIFIED} — couldn&apos;t confirm</option>
                  </Select>
                </Field>
                {f.contributionStatus === "VERIFIED" && (
                  <Field htmlFor="cc-verified" label="Verified amount" hint="Only this amount counts against the charge." error={errors.contributionVerified}>
                    <Input id="cc-verified" inputMode="decimal" placeholder={f.contributionReported} value={f.contributionVerified} disabled={!canVerify} onChange={(e) => set("contributionVerified", e.target.value)} />
                  </Field>
                )}
                <Field htmlFor="cc-contribution-source" label="Who says so">
                  <Select id="cc-contribution-source" value={f.contributionSource} disabled={!editable} onChange={(e) => set("contributionSource", e.target.value)}>
                    <option value="">—</option>
                    {CONTRIBUTION_SOURCES.map((s) => <option key={s} value={s}>{CONTRIBUTION_SOURCE_LABEL[s]}</option>)}
                  </Select>
                </Field>
                <Field htmlFor="cc-contribution-ref" label="Reference">
                  <Input id="cc-contribution-ref" placeholder="Rider name, receipt, payout id…" value={f.contributionReference} disabled={!editable} onChange={(e) => set("contributionReference", e.target.value)} />
                </Field>
              </div>
            </section>
          )}

          {applies && ((p.uncovered ?? 0) > 0 || (p.excess ?? 0) > 0 || f.uncoveredTreatment !== "UNDECIDED" || f.excessTreatment !== "UNDECIDED") && (
            <section>
              <SectionTitle hint="An uncovered amount isn't owed by the customer unless you say so here.">Who bears the difference</SectionTitle>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {((p.uncovered ?? 0) > 0 || f.uncoveredTreatment !== "UNDECIDED") && (
                  <Field htmlFor="cc-uncovered" label={`Uncovered${p.uncovered ? ` ${formatPrice(p.uncovered / 100)}` : ""}`}>
                    <Select id="cc-uncovered" value={f.uncoveredTreatment} disabled={!canVerify} onChange={(e) => set("uncoveredTreatment", e.target.value as UncoveredTreatment)}>
                      {UNCOVERED_TREATMENTS.map((t) => <option key={t} value={t}>{UNCOVERED_TREATMENT_LABEL[t]}</option>)}
                    </Select>
                  </Field>
                )}
                {((p.excess ?? 0) > 0 || f.excessTreatment !== "UNDECIDED") && (
                  <Field htmlFor="cc-excess" label={`Excess${p.excess ? ` ${formatPrice(p.excess / 100)}` : ""}`}>
                    <Select id="cc-excess" value={f.excessTreatment} disabled={!canVerify} onChange={(e) => set("excessTreatment", e.target.value as ExcessTreatment)}>
                      {EXCESS_TREATMENTS.filter((t) => t !== "ALLOCATED_WITHIN_EXCHANGE" || isExchangeLeg).map((t) => <option key={t} value={t}>{EXCESS_TREATMENT_LABEL[t]}</option>)}
                    </Select>
                  </Field>
                )}
              </div>
              {!canVerify && <p className="mt-2 text-xs text-fg-muted">The owner or finance decides this.</p>}
            </section>
          )}

          <section className="space-y-3">
            <Field htmlFor="cc-note" label="Note">
              <Textarea id="cc-note" rows={2} value={f.note} disabled={!editable} onChange={(e) => set("note", e.target.value)} />
            </Field>
            {((reasonLikely && dirty) || f.reason) && (
              <Field htmlFor="cc-reason" label="Reason for this change" required error={errors.reason}>
                <Input id="cc-reason" value={f.reason} onChange={(e) => set("reason", e.target.value)} />
              </Field>
            )}
          </section>

          <section>
            <button type="button" className="flex items-center gap-1.5 text-sm font-medium text-fg-muted hover:text-fg" aria-expanded={showHistory} onClick={() => setShowHistory((v) => !v)}>
              <History size={14} aria-hidden="true" /> History ({legEvents.length})
            </button>
            {showHistory && <div className="mt-3"><HistoryList events={legEvents} /></div>}
          </section>
        </div>

        <div className="sticky bottom-0 space-y-2 border-t border-line-subtle bg-surface px-5 py-3">
          {!dirty && !shipment.reconciledAt && preview.blocker && p.financialStatus !== "NOT_DUE" && (
            <p className="flex items-start gap-1.5 text-xs text-fg-muted"><AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />{preview.blocker}</p>
          )}
          {shipment.reconciledAt && (
            <p className="flex items-center gap-1.5 text-xs text-success-700"><CheckCircle2 size={13} aria-hidden="true" />Reconciled{shipment.reconciledBy ? ` by ${shipment.reconciledBy.name}` : ""}, {formatStoreDateTime(shipment.reconciledAt)}</p>
          )}
          <div className={cn("flex flex-wrap items-center gap-2", "justify-end")}>
            {canVerify && shipment.reconciledAt && !dirty && reopenReason === null && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setReopenReason("")}>
                <RotateCcw size={13} aria-hidden="true" /> Reopen
              </Button>
            )}
            {canVerify && shipment.reconciledAt && !dirty && reopenReason !== null && (
              <div className="flex w-full flex-col gap-2 sm:flex-row">
                <Input aria-label="Why reopen" placeholder="Why reopen this record?" value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} autoFocus />
                <Button type="button" size="sm" variant="outline" disabled={reopenReason.trim().length < 3} loading={reopen.isPending} onClick={() => reopen.mutate(reopenReason.trim())}>
                  Reopen
                </Button>
              </div>
            )}
            {canVerify && !shipment.reconciledAt && !dirty && !preview.blocker && (
              <Button type="button" variant="outline" size="sm" loading={reconcile.isPending} onClick={() => reconcile.mutate()}>
                <CheckCircle2 size={13} aria-hidden="true" /> Mark reconciled
              </Button>
            )}
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>Close</Button>
            {editable && (
              <Button type="submit" size="sm" disabled={!dirty || hasErrors || pending} loading={save.isPending}>
                Save
              </Button>
            )}
          </div>
          {dirty && <p className="text-right text-[11px] text-fg-subtle">Will be: {SHIPMENT_FINANCIAL_STATUS_LABEL[p.financialStatus]}</p>}
        </div>
      </form>
    </Drawer>
  );
}
