import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PERMISSIONS } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { cleanupFixtures, ownerId, purgeFinanceTables } from "../../test-fixtures";
import { ensureCommerceAccounting } from "./commerce-setup.service";
import { updateBusinessSettings } from "./chart.service";
import { getOpeningBalances, postOpeningBalances, saveOpeningLines } from "./opening-balances.service";
import { getFinanceContext } from "./finance-context";
import { booksStarted } from "./finance-facts";
import type { FinanceActor } from "./finance-audit";

// A business that started after its opening date held nothing on it: the books start with no opening journal, and
// everything after is entered on its own day (docs/FINANCE_PHASE_1.md §8).

let OWNER: FinanceActor;

beforeAll(async () => {
  await purgeFinanceTables();
  OWNER = { type: "ADMIN", adminId: await ownerId(), label: "owner@test", permissions: [...PERMISSIONS] };
  await ensureCommerceAccounting(OWNER);
  await updateBusinessSettings({ openingDate: "2026-07-01", reason: "test" }, OWNER);
});

afterAll(async () => {
  await purgeFinanceTables();
  await cleanupFixtures();
});

describe("opening balances when the business held nothing", () => {
  it("an empty batch is refused unless it says nothing was held; one with a line can't claim that", async () => {
    await expect(postOpeningBalances(OWNER)).rejects.toMatchObject({ details: { code: "OPENING_EMPTY" } });
    const { business } = await getFinanceContext();
    const capital = await prisma.ledgerAccount.findFirstOrThrow({ where: { businessId: business.id, code: "3100" } });
    await saveOpeningLines({ lines: [{ category: "CAPITAL", accountId: capital.id, side: "CREDIT", amount: 100 }] }, OWNER);
    await expect(postOpeningBalances(OWNER, { nothingHeld: true })).rejects.toMatchObject({ details: { code: "OPENING_NOT_EMPTY" } });
    await saveOpeningLines({ lines: [] }, OWNER);
  });

  it("posts with no journal, and the books have started", async () => {
    const r = await postOpeningBalances(OWNER, { nothingHeld: true });
    expect(r.journal).toBeNull();
    expect(r.batch).toMatchObject({ status: "POSTED", journalEntryId: null, openingDate: "2026-07-01" });
    expect(await booksStarted(await getFinanceContext())).toBe(true);
    expect((await getOpeningBalances()).batch?.status).toBe("POSTED");
    await expect(postOpeningBalances(OWNER, { nothingHeld: true })).rejects.toMatchObject({ details: { code: "OPENING_POSTED" } });
  });
});
