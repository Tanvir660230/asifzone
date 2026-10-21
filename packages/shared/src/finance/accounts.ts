/**
 * Chart of accounts vocabulary and the default template (Financial Core Phase 1, docs/FINANCE_PHASE_1.md §3).
 *
 * Code never names an account id or code to post to: it names a MAPPING KEY (below), and the business's AccountMapping row
 * says which account that key posts to. The template is only the starting point a business is bootstrapped with; every
 * account and mapping is editable afterwards.
 */

export const LEDGER_ACCOUNT_TYPES = ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "COGS", "EXPENSE", "OTHER_INCOME", "OTHER_EXPENSE"] as const;
export type LedgerAccountType = (typeof LEDGER_ACCOUNT_TYPES)[number];

export type NormalBalance = "DEBIT" | "CREDIT";

/** The side that increases an account of this type. Contra accounts (accumulated depreciation, drawings, sales returns)
 * override it explicitly on the account. */
export function defaultNormalBalance(type: LedgerAccountType): NormalBalance {
  return type === "ASSET" || type === "COGS" || type === "EXPENSE" || type === "OTHER_EXPENSE" ? "DEBIT" : "CREDIT";
}

/** Balance-sheet accounts carry their balance forward; income-statement accounts reset each fiscal year (via retained
 * earnings at year end — Phase 14). */
export function isBalanceSheetType(type: LedgerAccountType): boolean {
  return type === "ASSET" || type === "LIABILITY" || type === "EQUITY";
}

/**
 * Every place the system posts to automatically. Adding a key here is the only way code gains a new posting target.
 * `group.*` keys are PARENT (non-postable) accounts under which the system creates one child per financial account.
 */
export const ACCOUNT_MAPPING_KEYS = [
  "group.cash",
  "group.bank",
  "group.mobile_wallet",
  "group.payment_gateway",
  "group.courier",
  "group.other_money",
  "equity.opening_balance",
  "equity.owner_capital",
  "equity.retained_earnings",
  "asset.inventory",
  "asset.receivable_trade",
  "asset.fixed_assets",
  "liability.payable_trade",
  "liability.customer_deposits",
  "liability.store_credit",
  "liability.vat_output",
  "liability.loans",
  "revenue.merchandise",
  "revenue.shipping",
  "revenue.returns_refunds",
  "cogs.goods",
  "cogs.inventory_shrinkage",
  // Phase 3 (docs/FINANCE_PHASE_3.md §3) — commerce accounting
  "liability.store_credit_reserved",
  "liability.refunds_payable",
  "revenue.price_adjustments",
  "revenue.other_refunds",
  "revenue.store_credit_returns",
  "revenue.exchange_differences",
  "expense.courier_fees",
  "expense.gateway_fees",
  "expense.settlement_adjustments",
  // Phase 4 (docs/FINANCE_PHASE_4.md §3) — purchasing, AP and inventory costing
  "liability.grni",
  "liability.supplier_returns",
  "asset.vat_input",
  "cogs.cost_adjustments",
  "cogs.purchase_price_differences",
  "cogs.count_adjustments",
  "expense.non_recoverable_tax",
  "expense.freight_in",
  "expense.purchases_other",
  "income.purchase_discounts",
  // Manufacturing (docs/MANUFACTURING.md) — work in progress, production costs accrued, abnormal production losses
  "asset.wip",
  "liability.production_accrual",
  "cogs.production_losses",
  // Fixed assets (docs/FINANCE_FIXED_ASSETS.md) — accumulated depreciation, the depreciation charge, disposal gain / loss
  "asset.accumulated_depreciation",
  "expense.depreciation",
  "income.asset_disposal_gain",
  "expense.asset_disposal_loss",
  // the proceeds of a sold asset, owed until the Treasury deposit brings them in
  "asset.disposal_receivable",
  // Loans (docs/FINANCE_LOANS.md) — interest accrued on loans, the interest charge
  "liability.accrued_interest",
  "expense.interest",
  // Payroll (docs/FINANCE_PAYROLL.md) — net pay owed, the salary cost, deductions withheld, employer contributions
  "liability.salaries_payable",
  "expense.salaries",
  "liability.payroll_deductions",
  "expense.employer_contributions",
  // Owner's books (docs/FINANCE_OWNER_BOOKS.md) — ad-platform balances, prepaid costs, courier claims, charges accrued
  // until the payout statement replaces them, landed costs waiting to be allocated, packaging used, ads, cash over/short
  "group.ad_platform",
  "asset.prepaid",
  "asset.courier_claims",
  "liability.courier_charges_accrued",
  "liability.gateway_fees_accrued",
  "liability.landed_cost_clearing",
  "cogs.packaging",
  "expense.advertising",
  "expense.cash_over_short",
  "liability.owner_reimbursable",
  "revenue.outside_sales",
  "expense.unallocated",
  "expense.sms",
] as const;
/**
 * Clearing accounts (Phase 3): money the business has been paid that has not reached a bank or cash account yet — COD
 * the courier collected, gateway payments, manual receipts. Each is a FINANCIAL ACCOUNT (so it can be settled, carry a
 * statement and be reconciled like any money account); these keys map to its ledger account. They are provisioned, not
 * part of the chart template.
 */
export const CLEARING_ACCOUNTS = [
  { key: "clearing.cod", kind: "COURIER", name: "COD collections (courier clearing)", provider: null },
  { key: "clearing.gateway.sslcommerz", kind: "PAYMENT_GATEWAY", name: "SSLCommerz clearing", provider: "SSLCommerz" },
  { key: "clearing.gateway.eps", kind: "PAYMENT_GATEWAY", name: "EPS clearing", provider: "EPS" },
  { key: "clearing.manual_receipts", kind: "OTHER", name: "Manual receipts clearing", provider: null },
] as const;
export type ClearingMappingKey = (typeof CLEARING_ACCOUNTS)[number]["key"];
export const CLEARING_MAPPING_KEYS = CLEARING_ACCOUNTS.map((c) => c.key) as ClearingMappingKey[];

export type AccountMappingKey = (typeof ACCOUNT_MAPPING_KEYS)[number] | ClearingMappingKey;

export function isAccountMappingKey(value: string): value is AccountMappingKey {
  return (ACCOUNT_MAPPING_KEYS as readonly string[]).includes(value) || (CLEARING_MAPPING_KEYS as readonly string[]).includes(value);
}

export function isClearingMappingKey(value: string): value is ClearingMappingKey {
  return (CLEARING_MAPPING_KEYS as readonly string[]).includes(value);
}

/** Every key the commerce accounting (Phase 3) posts to — all must be mapped before a commerce event can post. */
export const COMMERCE_MAPPING_KEYS: readonly AccountMappingKey[] = [
  "asset.receivable_trade", "asset.inventory", "revenue.merchandise", "revenue.shipping", "revenue.returns_refunds",
  "revenue.price_adjustments", "revenue.other_refunds", "revenue.store_credit_returns", "revenue.exchange_differences",
  "liability.vat_output", "liability.store_credit", "liability.store_credit_reserved", "liability.refunds_payable",
  "cogs.goods", "cogs.inventory_shrinkage", "expense.courier_fees", "expense.gateway_fees", "expense.settlement_adjustments",
  ...CLEARING_MAPPING_KEYS,
];

/** Every key purchasing, AP and inventory costing (Phase 4) post to — all must be mapped before a purchasing document or a
 * valuation adjustment can post. Several share an account by default (aliases on the template), each stays re-mappable. */
export const PURCHASING_MAPPING_KEYS: readonly AccountMappingKey[] = [
  "asset.inventory", "liability.payable_trade", "liability.grni", "liability.supplier_returns", "asset.vat_input",
  "cogs.cost_adjustments", "cogs.purchase_price_differences", "cogs.count_adjustments", "cogs.inventory_shrinkage",
  "expense.non_recoverable_tax", "expense.freight_in", "expense.purchases_other", "income.purchase_discounts",
];

/** Every key manufacturing posts to: materials issued into work in progress, production costs accrued until invoiced,
 * finished goods out of WIP into inventory, the close's true-up (5150) and approved abnormal losses. */
export const MANUFACTURING_MAPPING_KEYS: readonly AccountMappingKey[] = [
  "asset.inventory", "asset.wip", "liability.production_accrual", "cogs.production_losses", "cogs.cost_adjustments",
];

/** Every key fixed assets post to: the asset cost, accumulated depreciation, the monthly charge and disposal gain / loss. */
export const FIXED_ASSET_MAPPING_KEYS: readonly AccountMappingKey[] = [
  "asset.fixed_assets", "asset.accumulated_depreciation", "expense.depreciation", "income.asset_disposal_gain", "expense.asset_disposal_loss", "asset.disposal_receivable",
];

/** Every key loans post to: the principal owed, interest accrued and not yet paid, and the interest charge. */
export const LOAN_MAPPING_KEYS: readonly AccountMappingKey[] = ["liability.loans", "liability.accrued_interest", "expense.interest"];

/** Every key payroll posts to by default (each pay component can name its own accounts). */
export const PAYROLL_MAPPING_KEYS: readonly AccountMappingKey[] = ["liability.salaries_payable", "expense.salaries", "liability.payroll_deductions", "expense.employer_contributions"];

/** Every key the owner's-books features post to (docs/FINANCE_OWNER_BOOKS.md): cash counts, courier and gateway charge
 * estimates, ad spend, prepaid costs, packaging used and landed costs. */
export const OWNER_BOOKS_MAPPING_KEYS: readonly AccountMappingKey[] = [
  "group.ad_platform", "asset.prepaid", "asset.courier_claims", "liability.courier_charges_accrued", "liability.gateway_fees_accrued",
  "liability.landed_cost_clearing", "cogs.packaging", "expense.advertising", "expense.cash_over_short", "liability.owner_reimbursable", "revenue.outside_sales", "expense.unallocated", "expense.sms", "expense.courier_fees",
  "expense.gateway_fees", "asset.inventory", "cogs.cost_adjustments", "cogs.inventory_shrinkage",
];

/**
 * Mapping keys whose ledger figure is reconciled against an existing authoritative business figure (the metrics registry,
 * docs/METRICS_REGISTRY.md). Revenue: the dashboard's realised net sales = merchandise sales − merchandise refunds, both
 * VAT-exclusive, so the ledger side is revenue.merchandise − revenue.returns_refunds. Cost: the dashboard's recorded COGS.
 */
export const RECONCILED_REVENUE_KEYS = { revenue: "revenue.merchandise", contra: "revenue.returns_refunds" } as const satisfies Record<string, AccountMappingKey>;
export const RECONCILED_COGS_KEY: AccountMappingKey = "cogs.goods";

export interface ChartTemplateAccount {
  code: string;
  name: string;
  type: LedgerAccountType;
  /** Parent code; absent = top level. */
  parent?: string;
  /** Group (summing) accounts can't take postings. */
  group?: boolean;
  /** Overrides the type's normal balance (contra accounts). */
  normalBalance?: NormalBalance;
  mapping?: AccountMappingKey;
  /** Further keys that post to this same account by default (Phase 4) — each is its own mapping row, re-mappable alone. */
  aliases?: readonly AccountMappingKey[];
  /** Ownership, partner and payroll accounts: balances visible only with finance.sensitive (Phase 3 §11). */
  sensitive?: boolean;
}

/** A Bangladesh-ready starting chart (VAT, bKash/Nagad, courier COD clearing). Codes are 4 digits; groups end in 00. */
export const DEFAULT_CHART_OF_ACCOUNTS: readonly ChartTemplateAccount[] = [
  { code: "1000", name: "Assets", type: "ASSET", group: true },
  { code: "1100", name: "Cash in hand", type: "ASSET", parent: "1000", group: true, mapping: "group.cash" },
  { code: "1200", name: "Bank accounts", type: "ASSET", parent: "1000", group: true, mapping: "group.bank" },
  { code: "1300", name: "Mobile wallets (bKash, Nagad)", type: "ASSET", parent: "1000", group: true, mapping: "group.mobile_wallet" },
  { code: "1400", name: "Payment gateway clearing", type: "ASSET", parent: "1000", group: true, mapping: "group.payment_gateway" },
  { code: "1450", name: "Courier COD clearing", type: "ASSET", parent: "1000", group: true, mapping: "group.courier" },
  { code: "1480", name: "Other money accounts", type: "ASSET", parent: "1000", group: true, mapping: "group.other_money" },
  { code: "1490", name: "Ad platform balances", type: "ASSET", parent: "1000", group: true, mapping: "group.ad_platform" },
  { code: "1500", name: "Receivables", type: "ASSET", parent: "1000", group: true },
  { code: "1510", name: "Trade receivables", type: "ASSET", parent: "1500", mapping: "asset.receivable_trade" },
  { code: "1520", name: "Employee advances", type: "ASSET", parent: "1500" },
  { code: "1530", name: "Asset sale proceeds receivable", type: "ASSET", parent: "1500", mapping: "asset.disposal_receivable" },
  { code: "1540", name: "Courier claims receivable", type: "ASSET", parent: "1500", mapping: "asset.courier_claims" },
  { code: "1600", name: "Inventory", type: "ASSET", parent: "1000", group: true },
  { code: "1610", name: "Merchandise inventory", type: "ASSET", parent: "1600", mapping: "asset.inventory" },
  { code: "1630", name: "Work in progress (production)", type: "ASSET", parent: "1600", mapping: "asset.wip" },
  { code: "1700", name: "Other current assets", type: "ASSET", parent: "1000", group: true },
  { code: "1710", name: "VAT input recoverable", type: "ASSET", parent: "1700", mapping: "asset.vat_input" },
  { code: "1720", name: "Prepaid expenses", type: "ASSET", parent: "1700", mapping: "asset.prepaid" },
  { code: "1800", name: "Fixed assets", type: "ASSET", parent: "1000", group: true },
  { code: "1810", name: "Equipment & machinery", type: "ASSET", parent: "1800", mapping: "asset.fixed_assets" },
  { code: "1820", name: "Furniture & fixtures", type: "ASSET", parent: "1800" },
  { code: "1830", name: "Computers", type: "ASSET", parent: "1800" },
  { code: "1840", name: "Vehicles", type: "ASSET", parent: "1800" },
  { code: "1890", name: "Accumulated depreciation", type: "ASSET", parent: "1800", normalBalance: "CREDIT", mapping: "asset.accumulated_depreciation" },

  { code: "2000", name: "Liabilities", type: "LIABILITY", group: true },
  { code: "2100", name: "Payables", type: "LIABILITY", parent: "2000", group: true },
  { code: "2110", name: "Trade payables (suppliers)", type: "LIABILITY", parent: "2100", mapping: "liability.payable_trade" },
  { code: "2115", name: "Goods received not invoiced", type: "LIABILITY", parent: "2100", mapping: "liability.grni", aliases: ["liability.supplier_returns"] },
  { code: "2116", name: "Production costs accrued, not invoiced", type: "LIABILITY", parent: "2100", mapping: "liability.production_accrual" },
  { code: "2117", name: "Landed costs to allocate", type: "LIABILITY", parent: "2100", mapping: "liability.landed_cost_clearing" },
  { code: "2120", name: "Owner paid on behalf of business", type: "LIABILITY", parent: "2100", mapping: "liability.owner_reimbursable" },
  { code: "2140", name: "Courier charges accrued", type: "LIABILITY", parent: "2100", mapping: "liability.courier_charges_accrued" },
  { code: "2145", name: "Gateway fees accrued", type: "LIABILITY", parent: "2100", mapping: "liability.gateway_fees_accrued" },
  { code: "2200", name: "Customer liabilities", type: "LIABILITY", parent: "2000", group: true },
  { code: "2210", name: "Customer deposits", type: "LIABILITY", parent: "2200", mapping: "liability.customer_deposits" },
  { code: "2220", name: "Store credit liability", type: "LIABILITY", parent: "2200", mapping: "liability.store_credit" },
  { code: "2225", name: "Store credit reserved at checkout", type: "LIABILITY", parent: "2200", mapping: "liability.store_credit_reserved" },
  { code: "2230", name: "Refunds payable", type: "LIABILITY", parent: "2200", mapping: "liability.refunds_payable" },
  { code: "2300", name: "Taxes", type: "LIABILITY", parent: "2000", group: true },
  { code: "2310", name: "VAT output payable", type: "LIABILITY", parent: "2300", mapping: "liability.vat_output" },
  { code: "2320", name: "Withholding tax payable (TDS/VDS)", type: "LIABILITY", parent: "2300" },
  { code: "2400", name: "Payroll liabilities", type: "LIABILITY", parent: "2000", group: true },
  { code: "2410", name: "Salaries payable", type: "LIABILITY", parent: "2400", sensitive: true, mapping: "liability.salaries_payable" },
  { code: "2420", name: "Payroll deductions & contributions payable", type: "LIABILITY", parent: "2400", sensitive: true, mapping: "liability.payroll_deductions" },
  { code: "2500", name: "Loans", type: "LIABILITY", parent: "2000", group: true },
  { code: "2510", name: "Bank loans", type: "LIABILITY", parent: "2500", mapping: "liability.loans" },
  { code: "2520", name: "Partner loans", type: "LIABILITY", parent: "2500", sensitive: true },
  { code: "2530", name: "Accrued loan interest", type: "LIABILITY", parent: "2500", mapping: "liability.accrued_interest" },
  { code: "2900", name: "Other liabilities", type: "LIABILITY", parent: "2000" },

  { code: "3000", name: "Equity", type: "EQUITY", group: true },
  { code: "3100", name: "Owner capital", type: "EQUITY", parent: "3000", mapping: "equity.owner_capital", sensitive: true },
  { code: "3200", name: "Partner current accounts", type: "EQUITY", parent: "3000", sensitive: true },
  { code: "3300", name: "Drawings", type: "EQUITY", parent: "3000", normalBalance: "DEBIT", sensitive: true },
  { code: "3400", name: "Retained earnings", type: "EQUITY", parent: "3000", mapping: "equity.retained_earnings" },
  { code: "3900", name: "Opening balance equity", type: "EQUITY", parent: "3000", mapping: "equity.opening_balance" },

  { code: "4000", name: "Revenue", type: "REVENUE", group: true },
  { code: "4100", name: "Merchandise sales", type: "REVENUE", parent: "4000", mapping: "revenue.merchandise" },
  { code: "4200", name: "Shipping income", type: "REVENUE", parent: "4000", mapping: "revenue.shipping" },
  { code: "4150", name: "Sales outside the website", type: "REVENUE", parent: "4000", mapping: "revenue.outside_sales" },
  { code: "4250", name: "Price adjustments", type: "REVENUE", parent: "4000", mapping: "revenue.price_adjustments" },
  { code: "4300", name: "Sales returns & refunds", type: "REVENUE", parent: "4000", normalBalance: "DEBIT", mapping: "revenue.returns_refunds" },
  { code: "4310", name: "Shipping & other refunds", type: "REVENUE", parent: "4000", normalBalance: "DEBIT", mapping: "revenue.other_refunds" },
  { code: "4320", name: "Returns settled in store credit", type: "REVENUE", parent: "4000", normalBalance: "DEBIT", mapping: "revenue.store_credit_returns" },
  { code: "4330", name: "Exchange price differences", type: "REVENUE", parent: "4000", mapping: "revenue.exchange_differences" },

  { code: "5000", name: "Cost of goods sold", type: "COGS", group: true },
  { code: "5100", name: "Cost of goods sold", type: "COGS", parent: "5000", mapping: "cogs.goods" },
  { code: "5150", name: "Inventory cost adjustments", type: "COGS", parent: "5000", mapping: "cogs.cost_adjustments", aliases: ["cogs.purchase_price_differences"] },
  { code: "5200", name: "Inventory shrinkage & write-offs", type: "COGS", parent: "5000", mapping: "cogs.inventory_shrinkage" },
  { code: "5210", name: "Inventory count adjustments", type: "COGS", parent: "5000", mapping: "cogs.count_adjustments" },
  { code: "5220", name: "Production losses & abnormal waste", type: "COGS", parent: "5000", mapping: "cogs.production_losses" },
  { code: "5300", name: "Packaging & fulfilment", type: "COGS", parent: "5000", mapping: "cogs.packaging" },

  { code: "6000", name: "Operating expenses", type: "EXPENSE", group: true },
  { code: "6100", name: "Rent", type: "EXPENSE", parent: "6000" },
  { code: "6200", name: "Salaries & wages", type: "EXPENSE", parent: "6000", sensitive: true, mapping: "expense.salaries" },
  { code: "6210", name: "Employer payroll contributions", type: "EXPENSE", parent: "6000", sensitive: true, mapping: "expense.employer_contributions" },
  { code: "6300", name: "Utilities", type: "EXPENSE", parent: "6000" },
  { code: "6400", name: "Internet, software & hosting", type: "EXPENSE", parent: "6000" },
  { code: "6410", name: "SMS", type: "EXPENSE", parent: "6000", mapping: "expense.sms" },
  { code: "6500", name: "Marketing & advertising", type: "EXPENSE", parent: "6000", mapping: "expense.advertising" },
  { code: "6600", name: "Delivery & courier", type: "EXPENSE", parent: "6000", mapping: "expense.courier_fees" },
  { code: "6650", name: "Freight-in & purchase charges", type: "EXPENSE", parent: "6000", mapping: "expense.freight_in" },
  { code: "6700", name: "Payment gateway fees", type: "EXPENSE", parent: "6000", mapping: "expense.gateway_fees" },
  { code: "6800", name: "Packaging", type: "EXPENSE", parent: "6000" },
  { code: "6850", name: "Depreciation", type: "EXPENSE", parent: "6000", mapping: "expense.depreciation" },
  { code: "6900", name: "Other operating expenses", type: "EXPENSE", parent: "6000", mapping: "expense.purchases_other" },
  { code: "6950", name: "Settlement adjustments", type: "EXPENSE", parent: "6000", mapping: "expense.settlement_adjustments" },
  { code: "6960", name: "Non-recoverable purchase tax", type: "EXPENSE", parent: "6000", mapping: "expense.non_recoverable_tax" },
  { code: "6970", name: "Cash over / short", type: "EXPENSE", parent: "6000", mapping: "expense.cash_over_short" },
  { code: "6990", name: "Expenses awaiting allocation", type: "EXPENSE", parent: "6000", mapping: "expense.unallocated" },

  { code: "7000", name: "Other income", type: "OTHER_INCOME", group: true },
  { code: "7100", name: "Interest income", type: "OTHER_INCOME", parent: "7000" },
  { code: "7200", name: "Purchase discounts received", type: "OTHER_INCOME", parent: "7000", mapping: "income.purchase_discounts" },
  { code: "7300", name: "Gain on disposal of assets", type: "OTHER_INCOME", parent: "7000", mapping: "income.asset_disposal_gain" },
  { code: "7900", name: "Miscellaneous income", type: "OTHER_INCOME", parent: "7000" },

  { code: "8000", name: "Other expenses & finance costs", type: "OTHER_EXPENSE", group: true },
  { code: "8100", name: "Interest expense", type: "OTHER_EXPENSE", parent: "8000", mapping: "expense.interest" },
  { code: "8200", name: "Bank & financing charges", type: "OTHER_EXPENSE", parent: "8000" },
  { code: "8300", name: "Loss on disposal of assets", type: "OTHER_EXPENSE", parent: "8000", mapping: "expense.asset_disposal_loss" },
  { code: "8900", name: "Miscellaneous expenses", type: "OTHER_EXPENSE", parent: "8000" },
];

/** Structural check of a chart template (also run on the default in tests): unique codes, parents exist and share the
 * type, mappings unique and complete. Returns problems; empty = valid. */
/** The mapping keys a template account carries: its primary mapping, then its aliases. */
export function templateMappings(a: ChartTemplateAccount): AccountMappingKey[] {
  return a.mapping ? [a.mapping, ...(a.aliases ?? [])] : [];
}

export function validateChartTemplate(accounts: readonly ChartTemplateAccount[]): string[] {
  const problems: string[] = [];
  const byCode = new Map<string, ChartTemplateAccount>();
  for (const a of accounts) {
    if (byCode.has(a.code)) problems.push(`duplicate code ${a.code}`);
    byCode.set(a.code, a);
  }
  const mapped = new Map<string, string>();
  for (const a of accounts) {
    if (a.parent) {
      const parent = byCode.get(a.parent);
      if (!parent) problems.push(`${a.code}: parent ${a.parent} missing`);
      else {
        if (!parent.group) problems.push(`${a.code}: parent ${a.parent} is not a group`);
        if (parent.type !== a.type) problems.push(`${a.code}: type ${a.type} differs from parent ${parent.type}`);
      }
    }
    if (a.aliases?.length && !a.mapping) problems.push(`${a.code}: aliases without a primary mapping`);
    for (const key of templateMappings(a)) {
      if (mapped.has(key)) problems.push(`mapping ${key} on ${mapped.get(key)} and ${a.code}`);
      mapped.set(key, a.code);
      if (key.startsWith("group.") !== Boolean(a.group)) problems.push(`${a.code}: mapping ${key} must ${a.group ? "not " : ""}be a group mapping`);
    }
  }
  for (const key of ACCOUNT_MAPPING_KEYS) if (!mapped.has(key)) problems.push(`mapping ${key} not assigned`);
  return problems;
}
