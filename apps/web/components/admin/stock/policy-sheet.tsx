"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { getErrorMessage } from "@/lib/api-client";
import * as stockApi from "@/lib/api/stock";
import type { StockItem, StockPolicy } from "@/lib/api/stock";
import { num, spacedUnit, variantWords, type ProductGroup } from "./stock-shared";

/** How each policy reads to the owner — the same words on the row and in the sheet. */
export const POLICY_WORDS: Record<StockPolicy, { label: string; detail: string }> = {
  TRACKED: { label: "Only what can be filled", detail: "Sells the filled bottles plus what the oil and bottles in stock can make." },
  UNLIMITED: { label: "Always on sale", detail: "Never sells out. Each bottle sold is owed and filled later; its cost is booked when it is filled." },
  BACKORDER: { label: "A few extra", detail: "Sells what can be made plus up to a set number of bottles owed with no oil behind them yet." },
};

const POLICIES: StockPolicy[] = ["TRACKED", "UNLIMITED", "BACKORDER"];

/** The policy a product's rows share, or null when its sizes differ. */
export function productPolicy(items: StockItem[]): StockItem["policy"] | null {
  return items.find((i) => i.policy)?.policy ?? null;
}

/** Sets how one attar sells past its filled bottles (inventory recovery phase 2): for the product, with a size overridden
 * when needed. Only the policy changes — no stock is added or removed. */
export function PolicySheet({ product, onClose }: { product: ProductGroup; onClose: () => void }) {
  const qc = useQueryClient();
  const base = product.items.find((i) => i.policy && !i.policy.overridden)?.policy ?? product.items[0]?.policy ?? null;
  const [policy, setPolicy] = useState<StockPolicy>(base?.policy ?? "TRACKED");
  const [limit, setLimit] = useState(base?.backorderLimit ? String(base.backorderLimit) : "");
  const [sizes, setSizes] = useState<Record<string, StockPolicy | "">>(() =>
    Object.fromEntries(product.items.map((i) => [i.variantId, i.policy?.overridden ? i.policy.policy : ""])),
  );
  const [reason, setReason] = useState("");
  const [tried, setTried] = useState(false);

  const needsLimit = policy === "BACKORDER" || Object.values(sizes).includes("BACKORDER");
  const limitOk = !needsLimit || /^\d+$/.test(limit.trim()) && Number(limit) >= 1 && Number(limit) <= 10_000;
  const reasonOk = reason.trim().length >= 3;
  const owed = product.items.reduce((s, i) => s + (i.policy?.owed ?? 0), 0);

  const save = useMutation({
    mutationFn: () =>
      stockApi.setStockPolicy(product.productId, {
        policy,
        backorderLimit: needsLimit ? Number(limit) : null,
        variants: product.items.length > 1 ? product.items.map((i) => ({ variantId: i.variantId, policy: sizes[i.variantId] || null })) : undefined,
        reason: reason.trim(),
      }),
    onSuccess: () => {
      toast.success("Selling rule saved");
      void qc.invalidateQueries({ queryKey: stockApi.stockKeys.all });
      onClose();
    },
    onError: (e) => toast.error(getErrorMessage(e, "Couldn't save the selling rule")),
  });

  const submit = () => {
    setTried(true);
    if (limitOk && reasonOk) save.mutate();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Selling — ${product.name}`}
      description="How it sells once the filled bottles run out. Stock is not changed."
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="stock-policy-form" loading={save.isPending} data-testid="policy-save">Save</Button>
        </>
      }
    >
      <form id="stock-policy-form" className="space-y-5" onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
        <fieldset className="space-y-2">
          <legend className="ui-label">Sells</legend>
          {POLICIES.map((p) => (
            <label key={p} className="flex cursor-pointer items-start gap-3 rounded-xl border border-line-subtle p-3 has-[:checked]:border-ink-400 has-[:checked]:bg-surface-muted">
              <input type="radio" name="stock-policy" value={p} checked={policy === p} onChange={() => setPolicy(p)} className="mt-1" data-testid={`policy-${p.toLowerCase()}`} />
              <span>
                <span className="block text-sm font-medium text-fg">{POLICY_WORDS[p].label}</span>
                <span className="block text-sm text-fg-muted">{POLICY_WORDS[p].detail}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {needsLimit && (
          <Field htmlFor="policy-limit" label="Bottles that may be owed with no oil behind them" required error={tried && !limitOk ? "A whole number from 1 to 10,000" : undefined}>
            <Input id="policy-limit" inputMode="numeric" className="tabular-nums sm:max-w-32" value={limit} onChange={(e) => setLimit(e.target.value)} data-testid="policy-limit" />
          </Field>
        )}

        {product.items.length > 1 && (
          <div className="space-y-2">
            <p className="ui-label">Per size <span className="font-normal text-fg-muted">(optional)</span></p>
            <ul className="space-y-2">
              {product.items.map((i) => (
                <li key={i.variantId} className="grid grid-cols-[minmax(0,1fr)_12rem] items-center gap-3 max-sm:grid-cols-1">
                  <span className="text-sm text-fg">{spacedUnit(variantWords(i))}</span>
                  <Select aria-label={`${variantWords(i)} — sells`} value={sizes[i.variantId] ?? ""} onChange={(e) => setSizes((s) => ({ ...s, [i.variantId]: e.target.value as StockPolicy | "" }))}>
                    <option value="">Same as the product</option>
                    {POLICIES.map((p) => <option key={p} value={p}>{POLICY_WORDS[p].label}</option>)}
                  </Select>
                </li>
              ))}
            </ul>
          </div>
        )}

        <Field htmlFor="policy-reason" label="Why" required error={tried && !reasonOk ? "Say why, in a few words" : undefined}>
          <Input id="policy-reason" value={reason} maxLength={300} placeholder="e.g. Filled every evening from the oil in stock" onChange={(e) => setReason(e.target.value)} data-testid="policy-reason" />
        </Field>

        {owed > 0 && <p className="text-sm text-fg-muted">{num(owed)} bottle{owed === 1 ? " is" : "s are"} owed on orders now. They stay owed whatever you choose — fill them on Stock › Filled.</p>}
      </form>
    </Modal>
  );
}
