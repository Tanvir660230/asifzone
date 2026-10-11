"use client";

import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, MapPin, Plus, X } from "lucide-react";
import { BD_DIVISIONS, type ShippingZoneRow } from "@clothing-brand/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { PageHeader } from "@/components/admin/page-header";
import { ModuleTabs } from "@/components/admin/module-tabs";
import { ALL_BD_DISTRICTS } from "@/components/admin/orders/order-filters";
import { describeApiError } from "@/lib/api-client";
import * as settingsApi from "@/lib/api/settings";
import { formatPrice, storeCurrencyCode } from "@/lib/format";
import { cn } from "@/lib/utils";

const zonesKey = ["shipping-zones"] as const;

/** "Dhaka, Gazipur · Sylhet division · 1207" — what a zone covers, in one line. */
function coverage(zone: Pick<ShippingZoneRow, "isDefault" | "matches">) {
  if (zone.isDefault) return "Every address no other zone covers";
  const of = (field: string) => zone.matches.filter((m) => m.field === field).map((m) => m.value);
  const parts = [
    of("DISTRICT").join(", "),
    of("DIVISION").length ? `${of("DIVISION").join(", ")} division${of("DIVISION").length > 1 ? "s" : ""}` : "",
    of("POSTCODE").length ? `Postcode ${of("POSTCODE").join(", ")}` : "",
  ].filter(Boolean);
  return parts.join(" · ") || "No rules";
}

interface Draft {
  id: string | null;
  name: string;
  isDefault: boolean;
  isProtected: boolean;
  isActive: boolean;
  priority: string;
  fee: string;
  freeOver: string;
  districts: string[];
  divisions: string[];
  postcodes: string;
}

function draftOf(zone: ShippingZoneRow | null): Draft {
  if (!zone) return { id: null, name: "", isDefault: false, isProtected: false, isActive: true, priority: "10", fee: "", freeOver: "", districts: [], divisions: [], postcodes: "" };
  const of = (field: string) => zone.matches.filter((m) => m.field === field).map((m) => m.value);
  return {
    id: zone.id,
    name: zone.name,
    isDefault: zone.isDefault,
    isProtected: zone.protected,
    isActive: zone.isActive,
    priority: String(zone.priority),
    fee: String(zone.fee),
    freeOver: zone.freeOverAmount === null ? "" : String(zone.freeOverAmount),
    districts: of("DISTRICT"),
    divisions: of("DIVISION"),
    postcodes: of("POSTCODE").join(", "),
  };
}

function ZoneEditor({ draft, onClose }: { draft: Draft; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [d, setD] = useState(draft);
  const [districtPick, setDistrictPick] = useState("");
  const set = (patch: Partial<Draft>) => setD((cur) => ({ ...cur, ...patch }));
  const done = (message: string) => {
    toast.success(message);
    queryClient.invalidateQueries({ queryKey: zonesKey });
    onClose();
  };
  const save = useMutation({
    mutationFn: () => {
      const matches = d.isDefault
        ? undefined
        : [
            ...d.districts.map((value) => ({ field: "DISTRICT" as const, value })),
            ...d.divisions.map((value) => ({ field: "DIVISION" as const, value })),
            ...d.postcodes
              .split(/[\s,]+/)
              .filter(Boolean)
              .map((value) => ({ field: "POSTCODE" as const, value })),
          ];
      const body = {
        name: d.name.trim(),
        priority: Number(d.priority) || 0,
        isActive: d.isActive,
        fee: Number(d.fee),
        freeOverAmount: d.freeOver.trim() === "" ? null : Number(d.freeOver),
        ...(matches ? { matches } : {}),
      };
      return d.id ? settingsApi.updateShippingZone(d.id, body) : settingsApi.createShippingZone({ ...body, matches: matches ?? [] });
    },
    onSuccess: () => done(d.id ? "Zone saved — checkout uses it now" : "Zone added — checkout uses it now"),
    onError: (err) => toast.error(describeApiError(err, "Couldn't save the zone")),
  });
  const remove = useMutation({
    mutationFn: () => settingsApi.deleteShippingZone(d.id!),
    onSuccess: () => done("Zone deleted"),
    onError: (err) => toast.error(describeApiError(err, "Couldn't delete the zone")),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  const currency = storeCurrencyCode();
  return (
    <form onSubmit={submit} className="space-y-5 px-6 py-5">
      <Field label="Name" htmlFor="zone-name">
        <Input id="zone-name" value={d.name} onChange={(e) => set({ name: e.target.value })} maxLength={60} placeholder="e.g. Chattogram city" required />
      </Field>

      {d.isDefault ? (
        <p className="rounded-lg bg-ink-900/[0.03] px-3 py-2.5 text-[13px] text-fg-muted">This is the default zone: it covers every address that no other zone covers, so it has no rules.</p>
      ) : (
        <fieldset className="space-y-3">
          <legend className="text-[13px] font-medium text-fg">Covers</legend>
          <div>
            <p className="mb-1.5 text-[13px] text-fg-muted">Districts</p>
            <div className="flex flex-wrap items-center gap-1.5">
              {d.districts.map((name) => (
                <span key={name} className="flex items-center gap-1 rounded-full bg-ink-900/[0.06] py-1 pl-2.5 pr-1 text-[13px]">
                  {name}
                  <button type="button" onClick={() => set({ districts: d.districts.filter((x) => x !== name) })} aria-label={`Remove ${name}`} className="rounded-full p-0.5 text-fg-subtle hover:text-fg">
                    <X size={12} aria-hidden="true" />
                  </button>
                </span>
              ))}
              <div className="w-48">
                <SearchableSelect
                  value={districtPick}
                  onChange={(value) => {
                    if (value && !d.districts.includes(value)) set({ districts: [...d.districts, value] });
                    setDistrictPick("");
                  }}
                  options={ALL_BD_DISTRICTS.filter((x) => !d.districts.includes(x))}
                  placeholder="Add a district…"
                />
              </div>
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-[13px] text-fg-muted">Whole divisions</p>
            <div className="flex flex-wrap gap-1.5">
              {BD_DIVISIONS.map((name) => {
                const on = d.divisions.includes(name);
                return (
                  <button
                    key={name}
                    type="button"
                    aria-pressed={on}
                    onClick={() => set({ divisions: on ? d.divisions.filter((x) => x !== name) : [...d.divisions, name] })}
                    className={cn("h-8 rounded-full border px-3 text-[13px] font-medium transition-colors duration-fast", on ? "border-accent bg-accent text-accent-fg" : "border-line bg-surface text-fg hover:border-line-strong")}
                  >
                    {name}
                  </button>
                );
              })}
            </div>
          </div>
          <Field label="Postcodes" htmlFor="zone-postcodes" hint="Optional. Separate with commas — e.g. 1207, 1209.">
            <Input id="zone-postcodes" value={d.postcodes} onChange={(e) => set({ postcodes: e.target.value })} inputMode="numeric" />
          </Field>
        </fieldset>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label={`Delivery fee (${currency})`} htmlFor="zone-fee">
          <Input id="zone-fee" type="number" min={0} step="0.01" value={d.fee} onChange={(e) => set({ fee: e.target.value })} required />
        </Field>
        <Field label={`Free delivery over (${currency})`} htmlFor="zone-free" hint="Leave empty for never.">
          <Input id="zone-free" type="number" min={0} step="0.01" value={d.freeOver} onChange={(e) => set({ freeOver: e.target.value })} />
        </Field>
      </div>

      {!d.isDefault && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Priority" htmlFor="zone-priority" hint="When two zones cover the same address, the higher number wins.">
            <Input id="zone-priority" type="number" min={0} max={1000} value={d.priority} onChange={(e) => set({ priority: e.target.value })} />
          </Field>
          <div>
            <p className="mb-2 text-[13px] font-medium text-fg">Active</p>
            <div className="flex items-center gap-2 text-[13px] text-fg-muted">
              <Switch checked={d.isActive} onChange={(checked) => set({ isActive: checked })} aria-label="Zone active" />
              {d.isActive ? "Used at checkout" : "Off — not used"}
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 border-t border-line-subtle pt-4">
        {d.id && !d.isProtected && !d.isDefault ? (
          <Button
            type="button"
            variant="ghost"
            className="text-danger-600"
            disabled={remove.isPending}
            onClick={() => {
              if (window.confirm(`Delete the zone "${d.name}"? Addresses it covers fall back to the other zones.`)) remove.mutate();
            }}
          >
            Delete zone
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={save.isPending || !d.name.trim() || d.fee === ""}>
            {d.id ? "Save" : "Add zone"}
          </Button>
        </div>
      </div>
    </form>
  );
}

/** Settings › Delivery zones (Admin V2 DR-17, owner 2026-10-08): what checkout charges for delivery, per area. */
export default function DeliveryZonesPage() {
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: zonesKey, queryFn: settingsApi.listShippingZones });
  const [editing, setEditing] = useState<Draft | null>(null);
  const zones = data?.items ?? [];

  return (
    <div>
      <PageHeader
        title="Delivery zones"
        description="What checkout charges for delivery. An address uses the matching zone with the highest priority; everything else uses the default zone."
        action={
          <Button onClick={() => setEditing(draftOf(null))}>
            <Plus size={16} aria-hidden="true" /> Add zone
          </Button>
        }
      />
      <ModuleTabs />
      {isError && !data && <ErrorState onRetry={() => refetch()} />}
      {isLoading && !data && <div className="h-64 animate-pulse rounded-2xl bg-ink-900/[0.04]" aria-busy="true" aria-label="Loading" />}
      {data && zones.length === 0 && <EmptyState icon={MapPin} title="No delivery zones" />}
      {zones.length > 0 && (
        <ul className="divide-y divide-line-subtle overflow-hidden rounded-2xl border border-line bg-surface shadow-xs">
          {zones.map((zone) => (
            <li key={zone.id}>
              <button type="button" onClick={() => setEditing(draftOf(zone))} className="flex w-full items-center gap-4 px-5 py-4 text-left transition-colors duration-fast hover:bg-ink-900/[0.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-[15px] font-medium text-fg">
                    {zone.name}
                    {zone.isDefault && <Badge>Default</Badge>}
                    {!zone.isActive && <Badge variant="warning">Off</Badge>}
                  </p>
                  <p className="mt-0.5 truncate text-[13px] text-fg-muted">{coverage(zone)}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-[15px] font-semibold tabular-nums text-fg">{formatPrice(zone.fee)}</p>
                  <p className="text-[12px] text-fg-muted">{zone.freeOverAmount === null ? "No free delivery" : `Free over ${formatPrice(zone.freeOverAmount)}`}</p>
                </div>
                <ChevronRight size={16} className="shrink-0 text-fg-subtle" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 text-[13px] text-fg-muted">A coupon with free shipping, or a cart of only free-delivery products, still makes delivery free.</p>

      <Drawer open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? editing.name || "Zone" : "New delivery zone"}>
        {editing && <ZoneEditor key={editing.id ?? "new"} draft={editing} onClose={() => setEditing(null)} />}
      </Drawer>
    </div>
  );
}
