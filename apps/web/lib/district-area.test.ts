import { describe, expect, it } from "vitest";
import { BD_ALL_AREA_OPTIONS, BD_AREAS_BY_DISTRICT, parseAreaDistrictOption } from "@clothing-brand/shared";
import { nextDistrictArea } from "./district-area";

const dhakaArea = BD_AREAS_BY_DISTRICT["Dhaka"]![0]!;
const dhakaOption = BD_ALL_AREA_OPTIONS.find((o) => parseAreaDistrictOption(o)?.area === dhakaArea && parseAreaDistrictOption(o)?.district === "Dhaka")!;

describe("nextDistrictArea (UX-20: one address rule)", () => {
  it("keeps the area when the new district contains it, clears it otherwise", () => {
    expect(nextDistrictArea({ district: "", area: dhakaArea }, { district: "Dhaka" })).toEqual({ district: "Dhaka", area: dhakaArea });
    expect(nextDistrictArea({ district: "Dhaka", area: dhakaArea }, { district: "Chattogram" }).area).toBe("");
  });

  it("an 'Area — District' pick sets both; a plain area keeps the district", () => {
    expect(nextDistrictArea({ district: "", area: "" }, { area: dhakaOption })).toEqual({ district: "Dhaka", area: dhakaArea });
    expect(nextDistrictArea({ district: "Dhaka", area: "" }, { area: dhakaArea })).toEqual({ district: "Dhaka", area: dhakaArea });
  });
});
