"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { getErrorMessage } from "@/lib/api-client";
import { stockKeys } from "@/lib/api/stock";
import { listSuppliers, purchasingKeys } from "@/lib/api/purchasing";
import { setItemSettings, type StockListItem } from "@/lib/api/stock-smart";
import { formatBookDate, formatPrice } from "@/lib/format";
import { ItemThumb } from "./item-thumb";
import { num, spacedUnit, variantWords } from "./stock-shared";

/**
 * One item from the stock list (docs/STOCK_HUB.md §7): its figures and what to do with it. An attar size opens its full
 * history (the trace) and its selling rule; a material or product shows the reorder suggestion and the settings behind
 * it — usual supplier, days to arrive, days of stock to keep.
 */
export interface ItemActions {
  onTrace: () => void;
  onPolicy?: () => void;
  /** The one thing to do with it now: fill what's owed, reorder what runs out, count it. */
  onFill?: () => void;
  onReorder?: () => void;
  onCount?: () => void;
}

const subtitleOf = (item: StockListItem) => (item.group === "FILL_TO_ORDER" ? `${spacedUnit(variantWords(item))} · filled when orders come` : item.group === "MATERIAL" ? "Material" : variantWords(item));

/** On a phone: the item in a sheet. (On wide screens the page shows ItemDetail in its side column instead.) */
export function ItemPanel({ item, showCost, canAdjust, actions, onClose }: { item: StockListItem; showCost: boolean; canAdjust: boolean; actions: ItemActions; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title={item.productName} description={subtitleOf(item)} widthClassName="max-w-lg">
      <ItemDetail item={item} showCost={showCost} canAdjust={canAdjust} actions={actions} />
    </Modal>
  );
}

/** The item beside the list on wide screens: its picture and name, then the same detail. */
export function ItemRail({ item, showCost, canAdjust, actions, onClose }: { item: StockListItem; showCost: boolean; canAdjust: boolean; actions: ItemActions; onClose: () => void }) {
  return (
    <section aria-label={item.label} className="space-y-5" data-testid="stock-item-rail">
      <button type="button" onClick={onClose} className="inline-flex items-center gap-1 text-sm text-fg-muted transition-colors duration-fast hover:text-fg" data-testid="stock-item-back">
        <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Activity
      </button>
      <div className="flex items-center gap-4">
        <ItemThumb imageUrl={item.imageUrl} name={item.productName} unit={item.unit} attar={item.group === "FILL_TO_ORDER"} size="lg" />
        <div className="min-w-0">
          <h2 className="text-lg font-semibold leading-snug tracking-tight text-fg">{item.productName}</h2>
          <p className="text-sm text-fg-muted">{subtitleOf(item)}</p>
        </div>
      </div>
      <ItemDetail item={item} showCost={showCost} canAdjust={canAdjust} actions={actions} />
    </section>
  );
}

function ItemDetail({ item, showCost, canAdjust, actions }: { item: StockListItem; showCost: boolean; canAdjust: boolean; actions: ItemActions }) {
  const unit = item.unit === "pcs" ? "" : ` ${spacedUnit(item.unit)}`;
  const attar = item.group === "FILL_TO_ORDER";
  const { onTrace, onPolicy } = actions;
  const next = item.status === "NEEDS_FILL" && actions.onFill
    ? <Button onClick={actions.onFill} data-testid="stock-item-fill">Mark {num(item.policy?.owed ?? 0)} filled</Button>
    : (item.status === "OUT" || item.status === "LOW") && !attar && actions.onReorder
      ? <Button onClick={actions.onReorder} data-testid="stock-item-reorder-now">Reorder{item.reorder?.suggested ? ` ${num(item.reorder.suggested)}${unit || " pcs"}` : ""}</Button>
      : null;
  return (
      <div className="space-y-6" data-testid="stock-item-panel">
        {(next || actions.onCount) && (
          <div className="flex flex-wrap gap-2">
            {next}
            {actions.onCount && <Button variant="outline" onClick={actions.onCount} data-testid="stock-item-count">Count it</Button>}
          </div>
        )}
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-line-subtle">
          <Figure label={attar ? "Filled" : "In stock"} value={`${num(Math.max(0, item.stock))}${unit}`} />
          <Figure label="On orders" value={num(item.reserved)} />
          <Figure label={attar ? "Can sell" : "Lasts"} value={attar ? (item.canSell === null ? "No limit" : num(item.canSell)) : item.daysLeft === null ? "—" : `${num(item.daysLeft)} days`} />
          <Figure label="Average cost" value={showCost && item.avgCost !== null ? formatPrice(item.avgCost) : "—"} />
        </dl>

        {attar ? (
          <div className="space-y-4">
            {(item.policy?.owed ?? 0) > 0 && <p className="text-sm text-fg">{num(item.policy!.owed)} bottle{item.policy!.owed === 1 ? "" : "s"} sold and waiting to be filled.</p>}
            {item.limitedBy && <p className="text-sm text-fg-muted">{item.limitedBy.name} runs out first — buy more of it to sell more.</p>}
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={onTrace} data-testid="stock-item-trace">Full history</Button>
              {onPolicy && <Button variant="ghost" onClick={onPolicy} data-testid="stock-item-policy">Selling rule</Button>}
            </div>
          </div>
        ) : (
          <ReorderSettings item={item} canAdjust={canAdjust} unit={unit} />
        )}

        <Link href={`/admin/inventory?variantId=${item.variantId}`} className="inline-block text-sm font-medium text-fg underline underline-offset-4" data-testid="stock-item-movements">Every stock movement</Link>
      </div>
  );
}

function Figure({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="bg-surface px-3 py-2.5">
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd className="mt-0.5 text-[15px] font-semibold tabular-nums text-fg">{value}</dd>
    </div>
  );
}

function ReorderSettings({ item, canAdjust, unit }: { item: StockListItem; canAdjust: boolean; unit: string }) {
  const qc = useQueryClient();
  const [supplier, setSupplier] = useState(item.settings.preferredSupplierId ?? "");
  const [lead, setLead] = useState(String(item.settings.leadTimeDays));
  const [cover, setCover] = useState(String(item.settings.coverDays));
  const suppliers = useQuery({ queryKey: purchasingKeys.suppliers({ status: "ACTIVE", pageSize: 200 }), queryFn: () => listSuppliers({ status: "ACTIVE", pageSize: 200 }), enabled: canAdjust });
  const leadN = Number(lead);
  const coverN = Number(cover);
  const leadBad = !Number.isInteger(leadN) || leadN < 0 || leadN > 120;
  const coverBad = !Number.isInteger(coverN) || coverN < 7 || coverN > 180;
  const changed = supplier !== (item.settings.preferredSupplierId ?? "") || leadN !== item.settings.leadTimeDays || coverN !== item.settings.coverDays;
  const save = useMutation({
    mutationFn: () => setItemSettings(item.variantId, { preferredSupplierId: supplier || null, leadTimeDays: leadN, coverDays: coverN }),
    onSuccess: () => {
      toast.success("Reorder settings saved");
      void qc.invalidateQueries({ queryKey: stockKeys.all });
    },
    onError: (e) => toast.error(getErrorMessage(e, "The settings couldn't be saved")),
  });

  return (
    <div className="space-y-4">
      <p className="text-sm text-fg" data-testid="stock-item-reorder">
        {item.reorder === null
          ? "Not used in the last 30 days, so there's nothing to reorder yet."
          : item.reorder.suggested === 0
            ? `Enough for now. Reorder by ${formatBookDate(item.reorder.orderBy)}.`
            : `Reorder ${num(item.reorder.suggested)}${unit || " pcs"} by ${formatBookDate(item.reorder.orderBy)}.`}
      </p>
      {canAdjust && (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!leadBad && !coverBad && changed) save.mutate();
          }}
        >
          <Field htmlFor="item-supplier" label="Usually bought from">
            <Select id="item-supplier" value={supplier} onChange={(e) => setSupplier(e.target.value)} disabled={suppliers.isLoading}>
              <option value="">{suppliers.isLoading ? "Loading…" : "Not set — use the last supplier"}</option>
              {(suppliers.data?.suppliers ?? []).map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field htmlFor="item-lead" label="Days to arrive" error={leadBad ? "0 to 120 days" : undefined}>
              <Input id="item-lead" inputMode="numeric" value={lead} onChange={(e) => setLead(e.target.value.replace(/\D/g, ""))} data-testid="item-lead" />
            </Field>
            <Field htmlFor="item-cover" label="Days of stock to keep" error={coverBad ? "7 to 180 days" : undefined}>
              <Input id="item-cover" inputMode="numeric" value={cover} onChange={(e) => setCover(e.target.value.replace(/\D/g, ""))} data-testid="item-cover" />
            </Field>
          </div>
          <Button type="submit" variant="outline" disabled={!changed || leadBad || coverBad} loading={save.isPending} data-testid="item-settings-save">Save settings</Button>
        </form>
      )}
    </div>
  );
}
