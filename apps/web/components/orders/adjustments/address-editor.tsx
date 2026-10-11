"use client";

import { BD_ALL_AREA_OPTIONS, BD_ALL_DISTRICTS, BD_AREAS_BY_DISTRICT, BD_DIVISION_BY_DISTRICT, parseAreaDistrictOption } from "@clothing-brand/shared";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Textarea } from "@/components/ui/textarea";
import type { DraftAddress } from "./use-modification-flow";

/** Recipient and delivery address of an order change — the same Bangladesh district/area data checkout uses. The server
 * re-resolves the delivery zone and fee when it prices the change. */
export function AddressEditor({ value, onChange, idPrefix }: { value: DraftAddress; onChange: (next: DraftAddress) => void; idPrefix: string }) {
  const areaOptions: readonly string[] = value.shippingDistrict ? (BD_AREAS_BY_DISTRICT[value.shippingDistrict] ?? []) : BD_ALL_AREA_OPTIONS;
  const set = (patch: Partial<DraftAddress>) => {
    const next = { ...value, ...patch };
    onChange({ ...next, shippingDivision: BD_DIVISION_BY_DISTRICT[next.shippingDistrict] ?? next.shippingDivision });
  };
  return (
    <div className="space-y-3" data-testid="address-editor">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field htmlFor={`${idPrefix}-name`} label="Recipient name">
          <Input id={`${idPrefix}-name`} autoComplete="name" value={value.customerName} onChange={(e) => set({ customerName: e.target.value })} />
        </Field>
        <Field htmlFor={`${idPrefix}-phone`} label="Phone">
          <Input id={`${idPrefix}-phone`} inputMode="tel" autoComplete="tel" value={value.customerPhone} onChange={(e) => set({ customerPhone: e.target.value })} />
        </Field>
        <Field htmlFor={`${idPrefix}-district`} label="District">
          <SearchableSelect id={`${idPrefix}-district`} value={value.shippingDistrict} onChange={(v) => set({ shippingDistrict: v, shippingArea: "" })} options={BD_ALL_DISTRICTS} placeholder="Search district…" />
        </Field>
        <Field htmlFor={`${idPrefix}-area`} label="Area / Thana">
          <SearchableSelect
            id={`${idPrefix}-area`}
            value={value.shippingArea}
            onChange={(v) => {
              const p = parseAreaDistrictOption(v);
              set(p ? { shippingDistrict: p.district, shippingArea: p.area } : { shippingArea: v });
            }}
            options={areaOptions}
            placeholder="Search area…"
          />
        </Field>
      </div>
      <Field htmlFor={`${idPrefix}-line`} label="House / road / details">
        <Textarea id={`${idPrefix}-line`} rows={2} value={value.shippingAddressLine} onChange={(e) => set({ shippingAddressLine: e.target.value })} />
      </Field>
    </div>
  );
}
