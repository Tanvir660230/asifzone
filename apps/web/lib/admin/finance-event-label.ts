/**
 * What each accounting event means for the books, in the owner's words — Books › Sales accounting and an order's money
 * section. Every type the API's posting rules produce is named here (lib/admin/finance-event-label.test.ts checks it);
 * an event added later still reads as words, never as its code.
 */
export const FINANCE_EVENT_LABEL: Record<string, string> = {
  "commerce.order.recognised": "Sale and its cost recorded",
  "commerce.order.recognition_reversed": "Sale reversed",
  "commerce.order.uncollected_written_off": "Unpaid cash on delivery written off",
  "commerce.payment.received": "Payment received",
  "commerce.refund.completed": "Refund paid",
  "commerce.return.restocked": "Return put back in stock",
  "commerce.return.sales_return": "Sales return",
  "commerce.return.written_off": "Return written off",
  "commerce.return_charge.received": "Return charge received",
  "commerce.store_credit.entry": "Store credit",
  "finance.ads.spend": "Ad spend",
  "finance.courier.charge_estimated": "Courier charge (estimate)",
  "finance.courier_claim.opened": "Courier claim for a lost parcel",
  "finance.courier_claim.paid_in_payout": "Courier claim paid in a payout",
  "finance.courier_claim.written_off": "Courier claim written off",
  "finance.expense.allocated": "Expense moved to where it belongs",
  "finance.gateway.fee_estimated": "Payment gateway fee (estimate)",
  "finance.landed_cost.allocated": "Transport and other costs added to goods",
  "finance.landed_cost.reversed": "Added goods costs reversed",
  "finance.partner.profit_share_adjusted": "Partner's profit share corrected",
  "finance.partner.profit_shared": "Partner's profit share",
  "finance.prepaid.amortised": "This month's part of a prepaid cost",
  "finance.stock.write_off_estimated": "Stock written off (estimate)",
};

/** "finance.loan.interest_accrued" → "Loan interest accrued" for a type not in the table yet. */
function readable(type: string): string {
  const parts = type.split(".");
  const words = (parts.length > 1 ? parts.slice(1) : parts).join(" ").replace(/_/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : type;
}

export function financeEventLabel(type: string): string {
  return FINANCE_EVENT_LABEL[type] ?? readable(type);
}
