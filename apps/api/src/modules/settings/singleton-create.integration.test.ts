import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../config/prisma";
import { cacheDel } from "../../config/redis";
import { loadTaxConfig, TAX_SETTING_ID } from "../../domain/pricing/pricing-config";
import { getSmsSettings } from "../sms-settings/sms-settings.service";
import { getSettings, invalidateSettingsCache } from "./settings.service";

// The settings singletons are created lazily on first read, so a fresh store's database has none. Several requests
// arriving together on that fresh database (a new installation's first page loads, or test files sharing a database in
// CI) must all get the row — never a unique-constraint error from two of them creating it at once.

const ROUNDS = 6;

let storeSnapshot: Awaited<ReturnType<typeof prisma.storeSetting.findUnique>>;
let smsSnapshot: Awaited<ReturnType<typeof prisma.smsNotificationSetting.findUnique>>;
let taxSnapshot: Awaited<ReturnType<typeof prisma.taxSetting.findUnique>>;

beforeAll(async () => {
  storeSnapshot = await prisma.storeSetting.findUnique({ where: { id: "singleton" } });
  smsSnapshot = await prisma.smsNotificationSetting.findUnique({ where: { id: "singleton" } });
  taxSnapshot = await prisma.taxSetting.findUnique({ where: { id: TAX_SETTING_ID } });
});

afterAll(async () => {
  // Put back exactly what the shared test database held, so later files see the settings they expect.
  if (storeSnapshot) await prisma.storeSetting.upsert({ where: { id: storeSnapshot.id }, create: storeSnapshot, update: storeSnapshot });
  if (smsSnapshot) await prisma.smsNotificationSetting.upsert({ where: { id: smsSnapshot.id }, create: smsSnapshot, update: smsSnapshot });
  if (taxSnapshot) await prisma.taxSetting.upsert({ where: { id: taxSnapshot.id }, create: taxSnapshot, update: taxSnapshot });
  await invalidateSettingsCache();
  await cacheDel("sms-settings:singleton");
});

describe("lazily created settings singletons", () => {
  it("store settings: concurrent first reads on a fresh database all succeed and create one row", async () => {
    await prisma.storeSetting.deleteMany({ where: { id: "singleton" } });
    await invalidateSettingsCache();
    const rows = await Promise.all(Array.from({ length: ROUNDS }, () => getSettings()));
    expect(rows.every((r) => r.id === "singleton")).toBe(true);
    expect(await prisma.storeSetting.count()).toBe(1);
  });

  it("SMS settings: concurrent first reads on a fresh database all succeed and create one row", async () => {
    await prisma.smsNotificationSetting.deleteMany({ where: { id: "singleton" } });
    await cacheDel("sms-settings:singleton");
    const rows = await Promise.all(Array.from({ length: ROUNDS }, () => getSmsSettings()));
    expect(rows.every((r) => r.id === "singleton")).toBe(true);
    expect(await prisma.smsNotificationSetting.count()).toBe(1);
  });

  it("tax settings: concurrent first reads on a fresh database all succeed and create one row", async () => {
    await prisma.taxSetting.deleteMany({ where: { id: TAX_SETTING_ID } });
    const configs = await Promise.all(Array.from({ length: ROUNDS }, () => loadTaxConfig()));
    expect(configs).toHaveLength(ROUNDS);
    expect(await prisma.taxSetting.count()).toBe(1);
  });
});
