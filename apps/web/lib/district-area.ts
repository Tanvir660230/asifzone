import { BD_AREAS_BY_DISTRICT, parseAreaDistrictOption } from "@clothing-brand/shared";

export interface DistrictArea {
  district: string;
  area: string;
}

/** The district → area rule, in one place (Blueprint V2 UX-20): a new district keeps the area only if it's in that
 * district; picking "Area — District" from the country-wide list sets both. */
export function nextDistrictArea(current: DistrictArea, change: { district: string } | { area: string }): DistrictArea {
  if ("district" in change) {
    const keep = (BD_AREAS_BY_DISTRICT[change.district] ?? []).includes(current.area);
    return { district: change.district, area: keep ? current.area : "" };
  }
  const parsed = parseAreaDistrictOption(change.area);
  return parsed ? { district: parsed.district, area: parsed.area } : { district: current.district, area: change.area };
}
