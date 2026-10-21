/**
 * Asif Zone: the owner's history, entered once (docs/FINANCE_EQUITY.md §9). Owner's figures given 2026-10-20/21.
 *
 * The books' opening date is 2026-07-01 (fixed: sales have posted since). The business held nothing then, so the books
 * start with nothing held, and everything Abrarul Haque Asif paid for is entered on its own day as money he put in:
 * goods into stock, setup costs spread over a year, the printer as an asset, VPS and domain over their terms, Meta ads
 * through an ad account. Sales that went out without a cost get the cost per piece from his list (caps ৳587, attar by
 * recipe), booked on the day of each sale, so every month's profit — and Mehedi Hasan's 20% — is right.
 *
 *   DATABASE_URL=… INSTALL_ID=… npx tsx scripts/finance/asif-zone-owner-history.ts --as <owner admin email>    # dry run
 *   … --apply                      everything above (idempotent: a second run changes nothing)
 *   … --apply --ads-to 2026-10-21  the day the $557 Meta total runs to (default today)
 *   … --apply --autopilot          then switch on the autopilot (payouts into his bKash, kept by him; monthly shares)
 *                                  and run it once — this books the shares of finished months, which can't be undone
 */
import { prisma } from "../../src/config/prisma";
import { resolveAdminIdentity } from "../../src/domain/auth/authorization";
import type { FinanceActor } from "../../src/domain/finance/finance-audit";
import { businessToday, getFinanceContext } from "../../src/domain/finance/finance-context";
import { setCostPolicy } from "../../src/domain/finance/chart.service";
import { getOpeningBalances, postOpeningBalances, saveOpeningInventory, saveOpeningLines } from "../../src/domain/finance/opening-balances.service";
import { createPartner, updatePartner } from "../../src/domain/finance/equity.service";
import { createFinancialAccount } from "../../src/domain/finance/financial-accounts.service";
import { ownerMoney } from "../../src/domain/finance/partner-profit.service";
import { createPrepaid } from "../../src/domain/finance/prepaid.service";
import { createAsset } from "../../src/domain/finance/fixed-assets.service";
import { createDraftJournal, postDraftJournal } from "../../src/domain/finance/journal.service";
import { listRateCards, saveGatewayRate, saveRateCard } from "../../src/domain/finance/rate-cards.service";
import { createCampaign, recordPeriodSpend } from "../../src/domain/finance/ads.service";
import { approveCostEstimate, syncCommerce } from "../../src/domain/finance/commerce-accounting.service";
import { acknowledgeException } from "../../src/domain/finance/finance-exceptions.service";
import { updateFinanceCenterSettings } from "../../src/domain/finance/finance-center.service";
import { syncOwnerBooks } from "../../src/domain/finance/owner-books-sync";
import { runAutopilot, updateAutopilotSettings } from "../../src/domain/finance/autopilot.service";

const STARTED = "2026-08-01";
const SOURCE = "owner's list, 2026-10-20/21; exact day not recorded";
const OWNER = { name: "Abrarul Haque Asif", email: "abrarulhaqueasif46@gmail.com", phone: "+8801320351497" };
const WORKER = { name: "Mehedi Hasan", email: "mhrony193@gmail.com", phone: "+8801640704904", pct: 20 };

/** ৳ per ml of attar oil, bottle by size, box and sticker per bottle; a cap with its packaging. */
const OIL: Record<string, number> = { AZHAAR: 38, ROYAL: 16, SWEET: 21, ZAYAN: 24 };
const BOTTLE: Record<string, number> = { "6ml": 50, "12ml": 52 };
const BOX = 50;
const STICKER = 0.5;
const CAP = 575 + 12;
const MATERIAL: Record<string, number> = { "MAT-OIL-AZHAR": 38, "MAT-OIL-ROYAL": 16, "MAT-OIL-SWEET": 21, "MAT-OIL-ZAYAN": 24, "MAT-BTL-6": 50, "MAT-BTL-12": 52, "MAT-BOX": 50, "MAT-STICKER": 0.5 };

/** Goods bought into stock (account 1610). Caps, oil and bottles: what went out plus what is left (Stock check, 2026-10-21). */
const GOODS: Array<[string, number]> = [
  ["Caps: 283 pcs × ৳575", 283 * 575],
  ["Cap packaging: 283 × ৳12", 283 * 12],
  ["Attar oil Azhar Elite: 2,624 ml × ৳38", 2624 * 38],
  ["Attar oil Royal Amber: 2,366 ml × ৳16", 2366 * 16],
  ["Attar oil Sweet Lux: 1,406 ml × ৳21", 1406 * 21],
  ["Attar oil Zayan Elixir: 1,978 ml × ৳24", 1978 * 24],
  ["Empty bottles 6 ml: 795 × ৳50", 795 * 50],
  ["Empty bottles 12 ml: 522 × ৳52", 522 * 52],
  ["Attar boxes: 1,500 × ৳50", 75_000],
  ["Stickers", 2_270],
];
/** Spent at once: [what, amount, expense account code]. */
const SPENT: Array<[string, number, string]> = [
  ["Bubble poly: 2 rolls", 4_000, "6800"],
  ["Black poly", 1_600, "6800"],
  ["Vehicle rental / logistics", 10_000, "6900"],
];
/** Used over a period: [key, what, amount, paid on, from, to, expense account code]. */
const OVER_TIME: Array<[string, string, number, string, string, string, string]> = [
  ["website", "Website build", 23_000, STARTED, STARTED, "2027-07-31", "6400"],
  ["logo", "Logo", 5_000, STARTED, STARTED, "2027-07-31", "6900"],
  ["eps-setup", "EPS payment gateway setup", 6_000, STARTED, STARTED, "2027-07-31", "6700"],
  ["domain-2026", "Domain asifzone.com (USD 12 at ৳122)", 1_464, "2026-09-16", "2026-09-16", "2027-09-15", "6400"],
  ["vps-2026", "VPS (USD 130 at ৳122)", 15_860, "2026-10-04", "2026-10-04", "2027-10-03", "6400"],
];
const PRINTER = { cost: 8_000, lifeMonths: 36 };
const ADS = { usd: 557, rate: 130, from: "2026-08-11" };

const STEADFAST_CARD = {
  effectiveFrom: STARTED,
  zones: [{ name: "Inside Dhaka", districts: ["Dhaka"], areas: [], charge: 55 }, { name: "Sub-Dhaka", districts: [], areas: ["Savar", "Keraniganj", "Dhamrai", "Tongi"], charge: 105 }],
  defaultCharge: 115, codPercent: 1, returnChargePercent: 100,
  notes: "Steadfast actual: Dhaka 55, Sub-Dhaka 105, outside 115; COD 1%; a return keeps the delivery charge",
};

const args = process.argv.slice(2);
const flag = (f: string) => args.includes(f);
const value = (f: string) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
const APPLY = flag("--apply");
const round2 = (n: number) => Math.round(n * 100) / 100;
const taka = (n: number) => `৳${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const say = (s: string) => console.log(s);

function unitCost(sku: string, product: string, size: string, category: string): number | null {
  if (MATERIAL[sku] !== undefined) return MATERIAL[sku]!;
  if (/cap/i.test(category)) return CAP;
  const oil = Object.keys(OIL).find((k) => product.toUpperCase().includes(k));
  const ml = /^(\d+)ml$/i.exec(size)?.[1];
  if (!oil || !ml || !BOTTLE[`${ml}ml`]) return null;
  return round2(OIL[oil]! * Number(ml) + BOTTLE[`${ml}ml`]! + BOX + STICKER);
}

async function journal(key: string, date: string, description: string, lines: Array<{ code: string; debit: number; credit: number; memo: string }>, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  const accounts = new Map((await prisma.ledgerAccount.findMany({ where: { businessId: business.id, code: { in: [...new Set(lines.map((l) => l.code))] } } })).map((a) => [a.code, a.id]));
  const { journal: j } = await createDraftJournal({ entryDate: date, description, lines: lines.map((l) => ({ accountId: accounts.get(l.code)!, debit: l.debit, credit: l.credit, memo: l.memo })) }, actor, `asif-zone-history:${key}`);
  if (j.status !== "POSTED") await postDraftJournal(j.id, actor);
}

async function main() {
  const email = value("--as");
  if (!email) throw new Error("Pass --as <owner admin email>");
  const admin = await prisma.adminUser.findUnique({ where: { email }, select: { id: true, email: true } });
  if (!admin) throw new Error(`No admin ${email}`);
  const identity = await resolveAdminIdentity(admin.id);
  if (!identity) throw new Error(`${email} can't sign in`);
  const actor: FinanceActor = { type: "ADMIN", adminId: admin.id, label: `${admin.email} (owner history)`, permissions: identity.permissions };
  const { business } = await getFinanceContext();
  const adsTo = value("--ads-to") ?? businessToday(business);
  const opening = await getOpeningBalances();
  say(`${business.name}: books from ${business.openingDate ?? "—"}, opening ${opening.batch?.status ?? "none"}${APPLY ? "" : " — DRY RUN (nothing written)"}`);
  if (!APPLY) {
    const goods = GOODS.reduce((s, [, a]) => s + a, 0), spent = SPENT.reduce((s, [, a]) => s + a, 0), over = OVER_TIME.reduce((s, x) => s + x[2], 0);
    say(`Put in by ${OWNER.name}: goods ${taka(goods)} + spent ${taka(spent)} + over time ${taka(over)} + printer ${taka(PRINTER.cost)} + Meta ${taka(ADS.usd * ADS.rate)} = ${taka(goods + spent + over + PRINTER.cost + ADS.usd * ADS.rate)}`);
    const open = await prisma.financeException.count({ where: { businessId: business.id, status: "OPEN", kind: { in: ["MISSING_COST", "UNVALUED_STOCK_WRITE_OFF"] } } });
    say(`Sales / write-offs without a cost, to be costed: ${open}`);
    return;
  }

  // 1. Rates, the dollar rate, cost prices.
  const rates = await listRateCards();
  if (!rates.courierCards.length) await saveRateCard(STEADFAST_CARD, actor);
  if (!rates.gatewayRates.some((r) => r.provider === "EPS_PG")) await saveGatewayRate({ provider: "EPS_PG", effectiveFrom: STARTED, percent: 2, fixed: 0, notes: "Owner, 2026-10-21: EPS takes 2%" }, actor);
  await updateFinanceCenterSettings({ defaultUsdRate: ADS.rate }, actor);
  let priced = 0;
  for (const v of await prisma.productVariant.findMany({ select: { id: true, sku: true, size: true, costPrice: true, product: { select: { name: true, category: { select: { name: true } } } } } })) {
    const cost = unitCost(v.sku, v.product.name, v.size, v.product.category?.name ?? "");
    if (cost === null || (v.costPrice !== null && Number(v.costPrice) === cost)) continue;
    await prisma.productVariant.update({ where: { id: v.id }, data: { costPrice: cost } });
    priced += 1;
  }
  say(`1. rates set; ৳${ADS.rate}/USD; ${priced} cost price(s) set`);

  // 2. The owner and the working partner.
  const partners = await prisma.partner.findMany({ where: { businessId: business.id } });
  const owner = partners.find((p) => p.role === "OWNER") ?? partners.find((p) => p.name === OWNER.name);
  if (!owner) await createPartner({ ...OWNER, joinedOn: STARTED, role: "OWNER", notes: "Owner. Paid every cost from his own money and keeps the Steadfast and EPS payouts." } as never, actor);
  else if (owner.role !== "OWNER") await updatePartner(owner.id, { role: "OWNER" } as never, actor);
  const share = { profitSharePct: WORKER.pct, shareFrom: STARTED, lossRule: "ZERO_IN_LOSS_MONTHS" as const, shareConfirmedNote: "Owner, 2026-10-21: 20% of each month's net profit; a loss month pays nothing and is not carried." };
  const worker = partners.find((p) => p.name === WORKER.name);
  if (!worker) await createPartner({ ...WORKER, joinedOn: STARTED, role: "WORKING", notes: "Runs the business. Paid by cash, bKash or bank (see each payment's note).", ...share } as never, actor);
  else if (Number(worker.profitSharePct) !== WORKER.pct || worker.shareFrom?.toISOString().slice(0, 10) !== STARTED) await updatePartner(worker.id, share as never, actor);
  say(`2. ${OWNER.name} (owner) and ${WORKER.name} (${WORKER.pct}% from ${STARTED})`);

  // 3. Start the books: nothing was held on the opening date.
  if (opening.batch?.status !== "POSTED") {
    if (opening.batch?.lines.length || opening.batch?.inventoryItems.length) {
      await saveOpeningLines({ notes: `The business started on ${STARTED}; nothing was held on ${business.openingDate}.`, lines: [] }, actor);
      await saveOpeningInventory([], actor);
    }
    await postOpeningBalances(actor, { nothingHeld: true });
  }
  say(`3. books started (${business.openingDate}, nothing held)`);

  // 4. What he paid for.
  const goodsTotal = GOODS.reduce((s, [, a]) => s + a, 0);
  await journal("goods", STARTED, `Goods and packaging bought by ${OWNER.name} (${SOURCE})`, [
    ...GOODS.map(([what, amount]) => ({ code: "1610", debit: amount, credit: 0, memo: what })),
    ...GOODS.map(([what, amount]) => ({ code: "3100", debit: 0, credit: amount, memo: `Put in by ${OWNER.name}: ${what}` })),
  ], actor);
  for (const [what, amount, code] of SPENT) {
    await journal(`spent:${what}`, STARTED, `${what}, paid by ${OWNER.name} (${SOURCE})`, [
      { code, debit: amount, credit: 0, memo: what },
      { code: "3100", debit: 0, credit: amount, memo: `Put in by ${OWNER.name}: ${what}` },
    ], actor);
  }
  await journal("printer", STARTED, `Printer, paid by ${OWNER.name} (${SOURCE})`, [
    { code: "1810", debit: PRINTER.cost, credit: 0, memo: "Printer" },
    { code: "3100", debit: 0, credit: PRINTER.cost, memo: `Put in by ${OWNER.name}: printer` },
  ], actor);
  if (!(await prisma.fixedAsset.findFirst({ where: { businessId: business.id, name: "Printer" } }))) {
    const acc = await prisma.ledgerAccount.findFirstOrThrow({ where: { businessId: business.id, code: "1810" } });
    await createAsset({ name: "Printer", category: "Equipment", assetAccountId: acc.id, acquisitionDate: STARTED, cost: PRINTER.cost, usefulLifeMonths: PRINTER.lifeMonths, sourceType: "OTHER", sourceRef: "asif-zone-history:printer", notes: SOURCE }, actor);
  }
  const pocketName = `${OWNER.name} — own money`;
  const pocket = (await prisma.financialAccount.findFirst({ where: { businessId: business.id, name: pocketName } }))
    ?? (await createFinancialAccount({ kind: "CASH", name: pocketName, metadata: { purpose: "Costs the owner pays from his own pocket: put in and paid out the same day" } }, actor));
  const codes = new Map((await prisma.ledgerAccount.findMany({ where: { businessId: business.id, code: { in: [...new Set(OVER_TIME.map((x) => x[6]))] } } })).map((a) => [a.code, a.id]));
  for (const [key, what, amount, paidOn, from, to, code] of OVER_TIME) {
    await ownerMoney({ kind: "INVEST", financialAccountId: pocket.id, amount, date: paidOn, note: what }, actor, `asif-zone:${key}`);
    await createPrepaid({ name: what, expenseAccountId: codes.get(code)!, amount, serviceStart: from, serviceEnd: to, paidOn, fromFinancialAccountId: pocket.id, notes: SOURCE }, actor, `asif-zone:${key}`);
  }
  say(`4. put in: goods ${taka(goodsTotal)}, ${SPENT.length} costs, printer, ${OVER_TIME.length} costs over time`);

  // 5. Meta ads: his card paid Meta; the spend comes out of the ad account day by day.
  const adAccount = (await prisma.financialAccount.findFirst({ where: { businessId: business.id, kind: "AD_PLATFORM" } }))
    ?? (await createFinancialAccount({ kind: "AD_PLATFORM", name: "Meta ads", provider: "Meta", metadata: { fxRate: ADS.rate } }, actor));
  const adTaka = ADS.usd * ADS.rate;
  await ownerMoney({ kind: "INVEST", financialAccountId: adAccount.id, amount: adTaka, date: ADS.from, note: `Meta ads paid by card, USD ${ADS.usd} at ৳${ADS.rate} (to ${adsTo})` }, actor, "asif-zone:meta-ads-to-2026-10-21");
  const campaign = (await prisma.adCampaign.findFirst({ where: { businessId: business.id, financialAccountId: adAccount.id } }))
    ?? (await createCampaign({ financialAccountId: adAccount.id, name: "Facebook & Instagram ads", startDate: ADS.from, notes: "All Meta ads since launch" }, actor));
  const ads = await recordPeriodSpend(campaign.id, { from: ADS.from, to: adsTo, originalAmount: ADS.usd, currency: "USD", fxRate: ADS.rate }, actor);
  say(`5. Meta: ${taka(ads.shared)} over ${ads.sharedDays} day(s) (${ads.ownDays} day(s) with their own figure)`);

  // 6. Sales that went out without a cost: the cost per piece, on the day of the sale. Stock lost or damaged: the same.
  //    Stock typed up or down in the product form is not a purchase or a loss — the goods were entered as bought in
  //    step 4 — so those notes are closed as seen.
  await syncCommerce({ full: true, actor }); // every sale raises its note first
  const b = await prisma.financeBusiness.findUniqueOrThrow({ where: { id: business.id }, select: { costPolicy: true } });
  if (b.costPolicy !== "APPROVED_ESTIMATES") await setCostPolicy({ costPolicy: "APPROVED_ESTIMATES", reason: `Owner's cost per piece (${SOURCE}) for sales before stock was valued` }, actor);
  const open = await prisma.financeException.findMany({ where: { businessId: business.id, status: "OPEN", kind: { in: ["MISSING_COST", "UNVALUED_STOCK_WRITE_OFF", "UNVALUED_STOCK_RECEIPT"] } }, select: { id: true, kind: true, details: true } });
  const moves = new Map((await prisma.stockMovement.findMany({ where: { id: { in: open.map((e) => (e.details as { movementId?: string }).movementId ?? "").filter(Boolean) } }, select: { id: true, reason: true } })).map((m) => [m.id, m.reason]));
  const cost = new Map((await prisma.productVariant.findMany({ select: { id: true, costPrice: true } })).map((v) => [v.id, v.costPrice ? Number(v.costPrice) : 0]));
  let costed = 0, skipped = 0, seen = 0;
  for (const e of open) {
    const reason = moves.get((e.details as { movementId?: string }).movementId ?? "");
    if (e.kind === "UNVALUED_STOCK_RECEIPT" || (e.kind === "UNVALUED_STOCK_WRITE_OFF" && reason !== "DAMAGED" && reason !== "LOST")) {
      await acknowledgeException(e.id, `Stock typed in the product form (${reason ?? "manual"}), not a purchase or a loss — the goods are entered as bought by ${OWNER.name} (${SOURCE})`, actor);
      seen += 1;
      continue;
    }
    const unit = cost.get((e.details as { variantId?: string }).variantId ?? "") ?? 0;
    if (!unit) { skipped += 1; continue; }
    await approveCostEstimate(e.id, unit, `Cost per piece from the ${SOURCE}`, actor);
    costed += 1;
  }
  say(`6. costed ${costed} sale line(s) / loss(es); ${seen} stock edit(s) closed as seen${skipped ? `; ${skipped} without a cost price left open` : ""}`);

  // 7. Bring everything up to date before anything reads a month's profit.
  await syncCommerce({ full: true, actor });
  await syncOwnerBooks();
  say("7. sales, charges, ads and prepaid costs brought up to date");

  if (flag("--autopilot")) {
    const walletName = `${OWNER.name} — bKash`;
    const wallet = (await prisma.financialAccount.findFirst({ where: { businessId: business.id, name: walletName } }))
      ?? (await createFinancialAccount({ kind: "MOBILE_WALLET", name: walletName, provider: "bKash", metadata: { purpose: "Steadfast pays out here; the owner keeps it" } }, actor));
    await updateAutopilotSettings({ payoutAccountId: wallet.id, payoutsToOwner: true, profitShares: true }, actor);
    const run = await runAutopilot(actor);
    say(`8. autopilot: ${JSON.stringify(run)}`);
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect())
  .then(() => process.exit());
