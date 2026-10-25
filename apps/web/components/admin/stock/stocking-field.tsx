"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { useCapabilities } from "@/hooks/use-capability";
import { getErrorMessage } from "@/lib/api-client";
import * as stockApi from "@/lib/api/stock";
import type { StockingMode } from "@/lib/api/stock";
import { cn } from "@/lib/utils";

const MODES: Array<{ value: StockingMode; label: string; detail: string }> = [
  { value: "READY", label: "Ready stock", detail: "Sold from the shelf — caps, clothes. Stock is what is there." },
  { value: "FILLED_TO_ORDER", label: "Filled to order", detail: "Filled from its recipe as orders come — attar. Stock is filled bottles; the selling rule says how far past them it sells." },
  { value: "MATERIAL", label: "Material", detail: "Used to make other products — oil, bottles, boxes. Never sold in the shop." },
];

/** "How it's stocked" on the product (docs/STOCK_HUB.md §8): ready, filled to order or a material. Only the setting
 * changes; a mode that isn't allowed says why (bottles owed, already sold, has a recipe). */
export function StockingField({ productId }: { productId: string }) {
  const { can } = useCapabilities();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: stockApi.stockKeys.stocking(productId), queryFn: () => stockApi.getStocking(productId), enabled: can("inventory.view") });
  const [target, setTarget] = useState<StockingMode | null>(null);
  const [reason, setReason] = useState("");
  const [unit, setUnit] = useState("pcs");
  const [tried, setTried] = useState(false);
  const save = useMutation({
    mutationFn: () => stockApi.setStocking(productId, { mode: target!, reason: reason.trim(), ...(target === "MATERIAL" ? { stockUnit: unit.trim() } : {}) }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: stockApi.stockKeys.all });
      if (r.warning) toast.warning(r.warning);
      else toast.success(`Now ${MODES.find((m) => m.value === r.mode)!.label.toLowerCase()}`);
      setTarget(null);
      setReason("");
      setTried(false);
    },
    onError: (e) => toast.error(getErrorMessage(e, "That couldn't be changed")),
  });

  if (!can("inventory.view")) return null;
  if (q.isLoading) return <Skeleton className="h-24 w-full" />;
  if (q.isError || !q.data) return <Alert variant="danger" title="How it's stocked couldn't be loaded" action={<Button size="sm" variant="outline" onClick={() => q.refetch()}>Retry</Button>}>{getErrorMessage(q.error, "")}</Alert>;
  const s = q.data;
  const canChange = can("inventory.adjust");
  const reasonOk = reason.trim().length >= 3;
  const unitOk = target !== "MATERIAL" || /^[A-Za-z][A-Za-z0-9 ./-]{0,15}$/.test(unit.trim());

  return (
    <div className="space-y-3" data-testid="stocking-field">
      <div role="radiogroup" aria-label="How it's stocked" className="grid gap-2 sm:grid-cols-3">
        {MODES.map((m) => {
          const current = s.mode === m.value;
          const blocked = current ? null : s.blocked[m.value];
          return (
            <button
              key={m.value}
              type="button"
              role="radio"
              aria-checked={current}
              disabled={!canChange || current || Boolean(blocked)}
              onClick={() => { setTarget(m.value); setTried(false); }}
              data-testid={`stocking-${m.value}`}
              className={cn(
                "flex min-h-11 flex-col items-start gap-1 rounded-xl border px-3 py-2.5 text-left transition-colors duration-fast",
                current ? "border-accent bg-accent/[0.06]" : "border-line bg-surface hover:border-line-strong disabled:hover:border-line",
                !current && (blocked || !canChange) && "cursor-not-allowed",
              )}
            >
              <span className="text-sm font-medium text-ink-900">{m.label}{current && <span className="sr-only"> (current)</span>}</span>
              <span className="text-xs text-ink-600">{blocked ?? m.detail}</span>
            </button>
          );
        })}
      </div>
      {s.mode === "FILLED_TO_ORDER" && !s.hasApprovedRecipe && (
        <Alert variant="warning" title="No approved recipe">It sells only bottles already filled until a recipe is approved. <Link href="/admin/manufacturing/boms" className="font-medium underline underline-offset-4">Add one in Recipes</Link>.</Alert>
      )}
      {s.mode === "FILLED_TO_ORDER" && <p className="text-xs text-ink-600">The selling rule (only what can be filled, always on sale, a few extra) is on the <Link href="/admin/stock" className="font-medium text-accent hover:underline">Stock page</Link> — open the item, then Selling rule.</p>}
      {target && (
        <Modal
          open
          onClose={() => setTarget(null)}
          title={`Make it ${MODES.find((m) => m.value === target)!.label.toLowerCase()}`}
          footer={<><Button variant="outline" onClick={() => setTarget(null)}>Cancel</Button><Button loading={save.isPending} onClick={() => { setTried(true); if (reasonOk && unitOk) save.mutate(); }} data-testid="stocking-save">Change</Button></>}
        >
          <div className="space-y-4">
            <p className="text-sm text-ink-700">{MODES.find((m) => m.value === target)!.detail} Stock and history stay as they are.</p>
            {target === "MATERIAL" && (
              <>
                <Alert variant="warning">A material can&apos;t be switched back to a product for sale. It leaves the product list and moves to Materials.</Alert>
                <Field htmlFor="stocking-unit" label="Counted in" required hint="The smallest unit you use: ml, g, cm, pcs" error={tried && !unitOk ? "A short unit such as ml, g or pcs" : undefined}>
                  <Input id="stocking-unit" value={unit} onChange={(e) => setUnit(e.target.value)} maxLength={16} className="sm:w-40" />
                </Field>
              </>
            )}
            <Field htmlFor="stocking-reason" label="Why" required error={tried && !reasonOk ? "Say why, in a few words" : undefined}>
              <Input id="stocking-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="e.g. We fill this attar to order" data-testid="stocking-reason" />
            </Field>
          </div>
        </Modal>
      )}
    </div>
  );
}
