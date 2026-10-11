"use client";

import { BD_ALL_AREA_OPTIONS, BD_ALL_DISTRICTS, BD_AREAS_BY_DISTRICT } from "@clothing-brand/shared";
import { Field } from "@/components/ui/field";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { nextDistrictArea, type DistrictArea } from "@/lib/district-area";

/** District and Area / Thana pickers for a Bangladesh delivery address — Create order and the order's customer section.
 * Until a district is chosen, the area list is every area in the country ("Area — District"), so staff can find a
 * customer's thana without knowing its district. The parent lays them out (two cells of its grid). */
export function DistrictAreaFields({
  value,
  onChange,
  idPrefix,
  errors,
}: {
  value: DistrictArea;
  onChange: (next: DistrictArea) => void;
  idPrefix: string;
  errors?: { district?: string; area?: string };
}) {
  const areaOptions: readonly string[] = value.district ? (BD_AREAS_BY_DISTRICT[value.district] ?? []) : BD_ALL_AREA_OPTIONS;
  return (
    <>
      <Field htmlFor={`${idPrefix}-district`} label="District" error={errors?.district}>
        <SearchableSelect
          id={`${idPrefix}-district`}
          value={value.district}
          onChange={(district) => onChange(nextDistrictArea(value, { district }))}
          options={BD_ALL_DISTRICTS}
          placeholder="Search district…"
        />
      </Field>
      <Field htmlFor={`${idPrefix}-area`} label="Area / Thana" error={errors?.area}>
        <SearchableSelect
          id={`${idPrefix}-area`}
          value={value.area}
          onChange={(area) => onChange(nextDistrictArea(value, { area }))}
          options={areaOptions}
          placeholder={value.district ? "Search area/thana…" : "Search area/thana (any district)…"}
        />
      </Field>
    </>
  );
}
