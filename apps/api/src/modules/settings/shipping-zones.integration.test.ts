import { describe, it, expect, afterAll } from "vitest";
import { resolveZone } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { asOwner } from "../../test-fixtures";
import { LEGACY_ZONE_KEYS, loadShippingZones, pricingConfigDrift } from "../../domain/pricing/pricing-config";
import { createShippingZone, deleteShippingZone, listShippingZones, updateShippingZone } from "./shipping-zones.service";

// Admin V2 DR-17 (owner, 2026-10-08): delivery zones are editable; the seeded zones and the legacy fee mirrors stay safe.

const created: string[] = [];
afterAll(async () => {
  await prisma.shippingZone.deleteMany({ where: { id: { in: created } } });
  await prisma.$disconnect();
});

describe("delivery zones (DR-17)", () => {
  it("a new zone wins for its district at checkout, and is removed cleanly", async () => {
    const zone = await createShippingZone({ name: "Vitest Chattogram", priority: 50, isActive: true, matches: [{ field: "DISTRICT", value: "Chattogram" }], fee: 99, freeOverAmount: 3000 });
    created.push(zone.id);
    expect(zone).toMatchObject({ key: "vitest-chattogram", fee: 99, freeOverAmount: 3000, protected: false, isDefault: false });
    const zones = await loadShippingZones("BDT");
    expect(resolveZone(zones, { district: "Chattogram", division: "Chattogram" })?.id).toBe(zone.id);
    expect(resolveZone(zones, { district: "Sylhet", division: "Sylhet" })?.key).toBe(LEGACY_ZONE_KEYS.outside);

    await updateShippingZone(zone.id, { isActive: false });
    expect(resolveZone(await loadShippingZones("BDT"), { district: "Chattogram" })?.id).not.toBe(zone.id);

    await deleteShippingZone(zone.id);
    expect((await listShippingZones()).find((z) => z.id === zone.id)).toBeUndefined();
  });

  it("keeps the default zone and the seeded zones safe", async () => {
    const zones = await listShippingZones();
    const fallback = zones.find((z) => z.isDefault)!;
    const dhaka = zones.find((z) => z.key === LEGACY_ZONE_KEYS.insideDhaka)!;
    expect(zones.at(-1)!.isDefault).toBe(true); // listed last
    await expect(updateShippingZone(fallback.id, { isActive: false })).rejects.toMatchObject({ statusCode: 400 });
    await expect(updateShippingZone(fallback.id, { matches: [{ field: "DISTRICT", value: "Dhaka" }] })).rejects.toMatchObject({ statusCode: 400 });
    await expect(deleteShippingZone(fallback.id)).rejects.toMatchObject({ statusCode: 400 });
    await expect(deleteShippingZone(dhaka.id)).rejects.toMatchObject({ statusCode: 400 });
    await expect(updateShippingZone(dhaka.id, { matches: [] })).rejects.toMatchObject({ statusCode: 400 });
  });

  it("a seeded zone's fee is mirrored to the legacy setting (no pricing-config drift)", async () => {
    const dhaka = (await listShippingZones()).find((z) => z.key === LEGACY_ZONE_KEYS.insideDhaka)!;
    try {
      await updateShippingZone(dhaka.id, { fee: dhaka.fee + 7 });
      const store = await prisma.storeSetting.findUniqueOrThrow({ where: { id: "singleton" } });
      expect(Number(store.shippingFeeDhaka)).toBe(dhaka.fee + 7);
      expect(await pricingConfigDrift()).toEqual([]);
    } finally {
      await updateShippingZone(dhaka.id, { fee: dhaka.fee });
    }
    expect(await pricingConfigDrift()).toEqual([]);
  });

  it("validates rules over HTTP: real districts and divisions, 4-digit postcodes, at least one rule", async () => {
    const agent = await asOwner();
    const bad = await agent.post("/api/settings/shipping-zones", { name: "Typo", matches: [{ field: "DISTRICT", value: "Chittagong City" }], fee: 80, freeOverAmount: null });
    expect(bad.status).toBe(400);
    expect((await agent.post("/api/settings/shipping-zones", { name: "Postcode", matches: [{ field: "POSTCODE", value: "12" }], fee: 80, freeOverAmount: null })).status).toBe(400);
    expect((await agent.post("/api/settings/shipping-zones", { name: "Nothing", matches: [], fee: 80, freeOverAmount: null })).status).toBe(400);
    const ok = await agent.post("/api/settings/shipping-zones", { name: "Vitest Sylhet", matches: [{ field: "DIVISION", value: "sylhet" }, { field: "DIVISION", value: "Sylhet" }], fee: 110, freeOverAmount: null });
    expect(ok.status).toBe(201);
    created.push(ok.body.id);
    expect(ok.body.matches).toEqual([{ field: "DIVISION", value: "Sylhet" }]); // official spelling, the same rule kept once
    const listed = await agent.get("/api/settings/shipping-zones");
    expect(listed.body.items.map((z: { id: string }) => z.id)).toContain(ok.body.id);
  });
});
