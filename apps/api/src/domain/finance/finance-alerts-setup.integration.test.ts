import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PERMISSIONS } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { ownerId, purgeFinanceTables } from "../../test-fixtures";
import { updateBusinessSettings } from "./chart.service";
import { financeAlerts } from "./finance-alerts.service";
import { businessToday, getFinanceContext } from "./finance-context";
import { postOpeningBalances, saveOpeningLines } from "./opening-balances.service";
import type { FinanceActor } from "./finance-audit";
import { addDays } from "@clothing-brand/shared";
import { confirmZeroSpendDays, createCampaign, recordDaySpend } from "./ads.service";
import { createFinancialAccount } from "./financial-accounts.service";

// Finance alerts before the books have started: an installation with no Financial Opening Date (or with opening balances
// still a draft) records nothing — every other finance page reads empty. The alert names that and links to the page that
// fixes it; it clears by itself once the opening balances are posted.

let OWNER: FinanceActor;

beforeAll(async () => {
  await purgeFinanceTables();
  OWNER = { type: "ADMIN", adminId: await ownerId(), label: "owner@test", permissions: [...PERMISSIONS] };
});

// Leave no books behind: the e2e suite runs on this database next and starts its own books.
afterAll(async () => {
  await purgeFinanceTables();
});

const startAlert = async () => (await financeAlerts()).alerts.find((a) => a.key === "books.not_started");

describe("alerts: the books haven't started", () => {
  it("is critical while there is no opening date, and links to Start the books", async () => {
    const { business } = await getFinanceContext();
    expect(business.openingDate).toBeNull();
    expect(await startAlert()).toMatchObject({ severity: "critical", count: 1, href: "/admin/finance/opening" });
  });

  it("stays while the opening balances are a draft, then clears once they are posted", async () => {
    const { business } = await getFinanceContext();
    const today = businessToday(business);
    await updateBusinessSettings({ openingDate: `${today.slice(0, 7)}-01` }, OWNER);
    const pending = await startAlert();
    expect(pending).toMatchObject({ severity: "warning", href: "/admin/finance/opening" });

    const mapped = async (key: string) => (await prisma.accountMapping.findUniqueOrThrow({ where: { businessId_key: { businessId: business.id, key } } })).accountId;
    await saveOpeningLines({ lines: [
      { category: "RECEIVABLE", accountId: await mapped("asset.receivable_trade"), side: "DEBIT", amount: 1000 },
      { category: "CAPITAL", accountId: await mapped("equity.owner_capital"), side: "CREDIT", amount: 1000 },
    ] }, OWNER);
    expect(await startAlert()).toBeDefined();
    await postOpeningBalances(OWNER);
    expect(await startAlert()).toBeUndefined();
  });
});

describe("alerts: ad spend missing", () => {
  it("says profit looks higher while a running campaign has days without spend, and clears once they are recorded", async () => {
    const { business } = await getFinanceContext();
    const today = businessToday(business);
    const first = `${today.slice(0, 7)}-01`;
    const yesterday = addDays(today, -1);
    if (yesterday <= addDays(first, 1)) return; // the first days of a month have no gap to show yet
    const account = await createFinancialAccount({ kind: "AD_PLATFORM", name: "Alerts Meta", provider: "Meta", accountReference: "act_alerts" } as never, OWNER);
    const campaign = await createCampaign({ financialAccountId: (account as { id: string }).id, name: "Alerts push", startDate: first } as never, OWNER);
    const id = (campaign as { id: string }).id;
    await recordDaySpend(id, { date: first, amount: 300 } as never, OWNER);
    const alert = (await financeAlerts()).alerts.find((a) => a.key === "ads.missing");
    const missing: string[] = [];
    for (let d = addDays(first, 1); d <= yesterday; d = addDays(d, 1)) missing.push(d);
    expect(alert).toMatchObject({ severity: "warning", count: missing.length, href: "/admin/finance/ads" });
    await confirmZeroSpendDays(id, { dates: missing, reason: "paused" }, OWNER);
    expect((await financeAlerts()).alerts.find((a) => a.key === "ads.missing")).toBeUndefined();
  });
});
