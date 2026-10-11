/**
 * Accounts-payable posting rule (Financial Core Phase 4E, docs/FINANCE_PHASE_4E.md). A posted supplier invoice or credit
 * note records one `payables.invoice_posted` event, in the posting transaction, whose payload carries the journal lines the
 * service computed — each naming a MAPPING KEY (or, for an expense line, the account the line chose) and the supplier as
 * party. The rule only checks that the lines balance and that every key is one this document may touch.
 *
 *   INVOICE:      Dr liability.grni (received goods, at their receipt value) · Dr/Cr asset.inventory (price difference,
 *                 the share still held — the sold share is moved on to 5150 by the costing engine) · Dr expense /
 *                 expense.non_recoverable_tax · Dr liability.production_accrual · Dr asset.vat_input  /  Cr liability.payable_trade
 *   CREDIT NOTE:  the mirror — Dr liability.payable_trade / Cr liability.supplier_returns (at the returned value), expense,
 *                 asset.vat_input, and the difference to the returned value against cogs.purchase_price_differences
 *   void:         a void revision (#r1) supersedes the posting — the processor reverses its journal
 */
import { z } from "zod";
import { registerPostingRule, type PostingRuleLine } from "./posting-rules";

export const PAYABLES_EVENT_TYPES = { invoicePosted: "payables.invoice_posted" } as const;

/** The mapping keys a supplier invoice may post to (an expense line names its own account instead). */
export const PAYABLES_POSTING_KEYS = [
  "liability.payable_trade",
  "liability.grni",
  "liability.supplier_returns",
  "liability.production_accrual",
  "asset.inventory",
  "asset.vat_input",
  "expense.non_recoverable_tax",
  "cogs.purchase_price_differences",
] as const;

const line = z.object({
  key: z.enum(PAYABLES_POSTING_KEYS).nullable(),
  accountId: z.string().nullable(),
  debit: z.number().int().nonnegative(),
  credit: z.number().int().nonnegative(),
  memo: z.string(),
  valuationStatus: z.enum(["KNOWN"]).nullable(),
});

const invoicePostedPayload = z.object({
  invoiceId: z.string(),
  number: z.string(),
  kind: z.enum(["INVOICE", "CREDIT_NOTE"]),
  supplierId: z.string(),
  totalMinor: z.number().int().nonnegative(),
  lines: z.array(line),
  void: z.boolean(),
  supersedes: z.string().nullable(),
});
export type InvoicePostedPayload = z.infer<typeof invoicePostedPayload>;

registerPostingRule(PAYABLES_EVENT_TYPES.invoicePosted, 1, {
  payload: invoicePostedPayload,
  build: (p) => {
    const reverses = p.supersedes ? [p.supersedes] : [];
    const what = p.kind === "INVOICE" ? "Supplier invoice" : "Supplier credit note";
    if (p.void) return { description: `${what} ${p.number} voided`, reference: p.number, lines: [], reverses };
    const lines: PostingRuleLine[] = p.lines
      .filter((l) => l.debit !== 0 || l.credit !== 0)
      .map((l) => {
        if ((l.key === null) === (l.accountId === null)) throw new Error("a payables line names a mapping key or an account, not both");
        return { account: l.key ?? { accountId: l.accountId! }, debit: l.debit, credit: l.credit, memo: l.memo, partyType: "Supplier", partyId: p.supplierId, valuationStatus: l.valuationStatus };
      });
    const dr = lines.reduce((s, l) => s + l.debit, 0);
    const cr = lines.reduce((s, l) => s + l.credit, 0);
    if (dr !== cr) throw new Error(`${what} ${p.number} doesn't balance (${dr} ≠ ${cr})`);
    if (!lines.length) return reverses.length ? { description: `${what} ${p.number}`, reference: p.number, lines: [], reverses } : { ignore: "nothing to post" };
    return { description: `${what} ${p.number}`, reference: p.number, lines, reverses };
  },
});
