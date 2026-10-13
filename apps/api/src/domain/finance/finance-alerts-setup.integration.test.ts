import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PERMISSIONS } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { ownerId, purgeFinanceTables } from "../../test-fixtures";
import { updateBusinessSettings } from "./chart.service";
import { financeAlerts } from "./finance-alerts.service";
import { businessToday, getFinanceContext } from "./finance-context";
import { postOpeningBalances, saveOpeningLines } from "./opening-balances.service";
import type { FinanceActor } from "./finance-audit";

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
