import { describe, expect, it } from "vitest";
import { orderAttentionItems, readBdAddress, searchBdAreas } from "@clothing-brand/shared";

const read = (addressLine: string, district?: string, area?: string) => readBdAddress({ addressLine, district, area });
const place = (addressLine: string) => {
  const r = read(addressLine);
  return r.area ? `${r.area}, ${r.district}` : r.district;
};
const codes = (addressLine: string, district?: string, area?: string) => read(addressLine, district, area).issues.map((i) => i.code);

describe("readBdAddress — the thana written in the address", () => {
  it("reads it the way people write: small place first, then thana, then district (addresses shaped like real orders)", () => {
    expect(place("Rail gate, Station road, Demra, Dhaka")).toBe("Demra, Dhaka");
    expect(place("Bank lane, near the post office, Kotwali, Dhaka")).toBe("Kotwali, Dhaka");
    expect(place("Gobindaganj")).toBe("Gobindaganj, Gaibandha");
    expect(place("Station bazar, Rajshahi")).toBe("Rajshahi");
  });

  it("reads Bangla", () => {
    expect(place("বাসা ১২, মিরপুর ১০, ঢাকা")).toBe("Mirpur, Dhaka");
    expect(place("কোদালধোয়া, ডেমরা, ঢাকা")).toBe("Demra, Dhaka");
    expect(place("গ্রাম: চরপাড়া, হালুয়াঘাট, ময়মনসিংহ")).toBe("Haluaghat, Mymensingh");
    expect(place("চান্দিনা, কুমিল্লা")).toBe("Chandina, Cumilla");
    expect(place("সৈয়দপুর, নীলফামারী")).toBe("Saidpur, Nilphamari");
  });

  it("a name several districts share is settled by the district, never guessed", () => {
    expect(place("Bazar road, Kaliganj, Gazipur")).toBe("Kaliganj, Gazipur");
    expect(place("কালীগঞ্জ, ঝিনাইদহ")).toBe("Kaliganj, Jhenaidah");
    expect(place("Mirpur, Kushtia")).toBe("Mirpur, Kushtia");
    expect(place("Kotwali, Chattogram")).toBe("Kotwali, Chattogram");
    const r = read("Main road, Kaliganj");
    expect(r.area).toBeNull();
    expect(r.district).toBeNull();
    expect(r.areaChoices.map((c) => c.district).sort()).toEqual(["Gazipur", "Jhenaidah", "Lalmonirhat", "Satkhira"]);
    expect(codes("Main road, Kaliganj")).toContain("AREA_UNCLEAR");
  });

  it("Mirpur and Mohammadpur alone mean Dhaka (most orders), as the district guess already does", () => {
    expect(place("House 4, Mirpur 10")).toBe("Mirpur, Dhaka");
    expect(place("মোহাম্মদপুর বাসস্ট্যান্ড")).toBe("Mohammadpur, Dhaka");
  });

  it("city thanas named after a common word need their district", () => {
    expect(read("বিমানবন্দর রোড, সিলেট").area).toBe("Airport");
    expect(read("near airport road").area).toBeNull();
    expect(read("Kotwali more").area).toBeNull();
  });

  it("the picked district decides a shared name the address leaves open", () => {
    expect(read("College road, Kaliganj", "Satkhira").area).toBe("Kaliganj");
    expect(read("College road, Kaliganj", "Satkhira").district).toBe("Satkhira");
  });

  it("Uttara alone: East or West is asked, not guessed; Sadar is read next to its district", () => {
    const r = read("Sector 7, Road 12, Uttara, Dhaka");
    expect(r.area).toBeNull();
    expect(r.areaChoices.map((c) => c.area).sort()).toEqual(["Uttara East", "Uttara West"]);
    expect(place("Link road, Cox's Bazar Sadar")).toBe("Cox's Bazar Sadar, Cox's Bazar");
    // Cumilla has two Sadar thanas: asked.
    expect(read("কুমিল্লা সদর").areaChoices.map((c) => c.area).sort()).toEqual(["Cumilla Adarsha Sadar", "Cumilla Sadar Dakshin"]);
  });

  it("Bogura's Sherpur thana is not Sherpur district", () => {
    expect(place("বগুড়া শেরপুর")).toBe("Sherpur, Bogura");
  });
});

describe("readBdAddress — checks for the confirmation call", () => {
  it("flags a picked thana the address contradicts (Adabor picked, Demra written)", () => {
    const r = read("House 7, Road 2, Matuail, Demra", "Dhaka", "Adabor");
    expect(r.area).toBe("Adabor");
    expect(r.issues).toContainEqual({ code: "AREA_MISMATCH", picked: { area: "Adabor", district: "Dhaka" }, written: { area: "Demra", district: "Dhaka" } });
  });

  it("flags a picked district the address contradicts", () => {
    expect(codes("Hospital road, mosque gali, Gazipur", "Dhaka", "Tejgaon")).toContain("DISTRICT_MISMATCH");
  });

  it("flags an address too short to find the door", () => {
    expect(codes("Link road", "Cox's Bazar", "Cox's Bazar Sadar")).toContain("ADDRESS_SHORT");
    expect(codes("Kalibari", "Bagerhat", "Bagerhat Sadar")).toContain("ADDRESS_SHORT");
    expect(codes("Gobindaganj")).toContain("ADDRESS_SHORT");
    expect(codes("Hospital road, mosque gali", "Gazipur", "Gazipur Sadar")).not.toContain("ADDRESS_SHORT");
    expect(codes("বাসা ১২, রোড ৩, মসজিদের পাশে, ফার্মগেট, ঢাকা", "Dhaka", "Tejgaon")).toEqual([]);
  });

  it("no thana anywhere is AREA_MISSING; a matching pick is clean", () => {
    expect(codes("Station bazar, Rajshahi")).toContain("AREA_MISSING");
    expect(codes("Rail gate, Station road, Demra, Dhaka", "Dhaka", "Demra")).toEqual([]);
  });
});

describe("searchBdAreas", () => {
  it("finds a thana typed in English or Bangla, shared names listed with their districts", () => {
    expect(searchBdAreas("demra")[0]).toEqual({ area: "Demra", district: "Dhaka" });
    expect(searchBdAreas("ডেমরা")[0]).toEqual({ area: "Demra", district: "Dhaka" });
    expect(searchBdAreas("kaliganj").map((p) => p.district).sort()).toEqual(["Gazipur", "Jhenaidah", "Lalmonirhat", "Satkhira"]);
    expect(searchBdAreas("kaliganj", { district: "Satkhira" })).toEqual([{ area: "Kaliganj", district: "Satkhira" }]);
    expect(searchBdAreas("kotwali rangpur")[0]).toEqual({ area: "Kotwali", district: "Rangpur" });
  });
});

describe("order attention — thana checks before booking", () => {
  const base = { status: "PENDING" as const, paymentStatus: "PENDING", courierConsignmentId: null, courierStatus: null, courierSyncError: null, followUpAt: null, partialDeliveryReconciledAt: null };
  const fmt = { price: (n: number) => String(n), dateTime: (d: string | Date) => String(d) };
  const keys = (o: Partial<Parameters<typeof orderAttentionItems>[0]>) => orderAttentionItems({ ...base, ...o }, fmt).map((i) => i.key);

  it("flags the real Adabor/Demra order and a shared name, stays quiet on a clean one or once booked", () => {
    expect(keys({ shippingAddressLine: "House 7, Road 2, Matuail, Demra", shippingDistrict: "Dhaka", shippingArea: "Adabor" })).toContain("thana-mismatch");
    expect(keys({ shippingAddressLine: "School para, main road, Kaliganj", shippingDistrict: "", shippingArea: "" })).toContain("thana-unclear");
    expect(keys({ shippingAddressLine: "Rail gate, Station road, Demra, Dhaka", shippingDistrict: "Dhaka", shippingArea: "Demra" })).toEqual([]);
    expect(keys({ courierConsignmentId: "123", shippingAddressLine: "Rail gate, Station road", shippingDistrict: "Dhaka", shippingArea: "" })).toEqual([]);
  });
});
