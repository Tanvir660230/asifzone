"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Minus, Package, Plus, Repeat, Trash2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { getProductBySlug } from "@/lib/api/storefront";
import { formatPrice } from "@/lib/format";
import { resolveImageUrl } from "@/lib/image-url";
import { cn } from "@/lib/utils";
import { draftLineFromVariant, ProductPicker, VariantChooser } from "./product-picker";
import { MAX_LINE_QUANTITY, type DraftLine } from "./use-modification-flow";

function SizeSwap({ line, onSwap, onCancel, exclude }: { line: DraftLine; onSwap: (next: DraftLine) => void; onCancel: () => void; exclude: string[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const { data } = useQuery({ queryKey: ["product-slug", line.productSlug], queryFn: () => getProductBySlug(line.productSlug!), enabled: Boolean(line.productSlug) });
  const product = data?.product;
  return (
    <div className="mt-2 space-y-2 rounded-xl border border-line-subtle bg-surface-muted p-3">
      <p className="text-sm font-medium text-ink-900">Choose another size or colour</p>
      {!product ? <p className="text-sm text-ink-500">Loading…</p> : <VariantChooser product={product} exclude={[line.variantId, ...exclude]} selected={selected} onSelect={setSelected} />}
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" disabled={!product || !selected} onClick={() => product && selected && onSwap({ ...draftLineFromVariant(product, selected), quantity: line.quantity })}>
          Use this option
        </Button>
      </div>
    </div>
  );
}

/**
 * The editable contents of an order change: quantity steppers, remove/undo, size/colour swap (a remove + add the server
 * prices), and adding products. Holds no prices beyond display hints.
 */
export function LineEditor({ lines, onChange, allowAdd = true }: { lines: DraftLine[]; onChange: (lines: DraftLine[]) => void; allowAdd?: boolean }) {
  const [adding, setAdding] = useState(false);
  const [swapping, setSwapping] = useState<string | null>(null);
  const update = (key: string, patch: Partial<DraftLine>) => onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const remove = (line: DraftLine) => (line.originalQuantity > 0 ? update(line.key, { quantity: 0 }) : onChange(lines.filter((l) => l.key !== line.key)));
  const inUse = lines.filter((l) => l.quantity > 0).map((l) => l.variantId);
  const active = lines.filter((l) => l.quantity > 0).length;

  function addLine(line: DraftLine) {
    const existing = lines.find((l) => l.variantId === line.variantId);
    if (existing) update(existing.key, { quantity: Math.min(MAX_LINE_QUANTITY, Math.max(existing.quantity, 0) + 1) });
    else onChange([...lines, line]);
    setAdding(false);
  }

  function swap(line: DraftLine, next: DraftLine) {
    const already = lines.find((l) => l.variantId === next.variantId);
    const withoutOld = lines.map((l) => (l.key === line.key ? (l.originalQuantity > 0 ? { ...l, quantity: 0 } : null) : l)).filter((l): l is DraftLine => l !== null);
    onChange(already ? withoutOld.map((l) => (l.variantId === next.variantId ? { ...l, quantity: Math.min(MAX_LINE_QUANTITY, l.quantity + next.quantity) } : l)) : [...withoutOld, next]);
    setSwapping(null);
  }

  return (
    <div className="space-y-3" data-testid="line-editor">
      <ul className="divide-y divide-line-subtle rounded-xl border border-line-subtle">
        {lines.map((line) => {
          const removed = line.quantity === 0;
          const label = [line.size, line.color].filter(Boolean).join(" / ");
          return (
            <li key={line.key} className={cn("p-3", removed && "bg-surface-muted")} data-testid="line-editor-row">
              <div className="flex items-start gap-3">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line-subtle bg-ink-50">
                  {line.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={resolveImageUrl(line.imageUrl)} alt="" className={cn("h-full w-full object-cover", removed && "opacity-40")} loading="lazy" />
                  ) : (
                    <Package size={16} className="text-ink-300" aria-hidden="true" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className={cn("font-medium text-ink-900", removed && "text-ink-400 line-through")}>{line.productName}</p>
                  <p className="text-xs text-ink-500">
                    {label}
                    {line.unitPriceHint !== null && ` · ${formatPrice(line.unitPriceHint)} each`}
                    {line.originalQuantity === 0 && <span className="ml-1.5 font-medium text-success-700">New</span>}
                    {removed && <span className="ml-1.5 font-medium text-danger-700">Removed</span>}
                  </p>
                  {!removed && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <div className="inline-flex items-center rounded-full border border-line-strong" role="group" aria-label={`Quantity of ${line.productName} ${label}`}>
                        <IconButton aria-label="Decrease quantity" size="lg" disabled={line.quantity <= 1} onClick={() => update(line.key, { quantity: line.quantity - 1 })}>
                          <Minus size={14} />
                        </IconButton>
                        <span className="min-w-8 text-center text-sm tabular-nums" aria-live="polite">
                          {line.quantity}
                        </span>
                        <IconButton aria-label="Increase quantity" size="lg" disabled={line.quantity >= MAX_LINE_QUANTITY} onClick={() => update(line.key, { quantity: line.quantity + 1 })}>
                          <Plus size={14} />
                        </IconButton>
                      </div>
                      {line.productSlug && (
                        <Button variant="ghost" size="sm" className="min-h-11" onClick={() => setSwapping(swapping === line.key ? null : line.key)} aria-expanded={swapping === line.key}>
                          <Repeat size={14} aria-hidden="true" /> Change size/colour
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" className="min-h-11" disabled={active <= 1} onClick={() => remove(line)} title={active <= 1 ? "An order needs at least one item" : undefined}>
                        <Trash2 size={14} aria-hidden="true" /> Remove
                      </Button>
                    </div>
                  )}
                  {removed && (
                    <Button variant="ghost" size="sm" className="mt-1 min-h-11" onClick={() => update(line.key, { quantity: line.originalQuantity })}>
                      <Undo2 size={14} aria-hidden="true" /> Undo
                    </Button>
                  )}
                  {swapping === line.key && <SizeSwap line={line} exclude={inUse} onSwap={(next) => swap(line, next)} onCancel={() => setSwapping(null)} />}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {allowAdd &&
        (adding ? (
          <ProductPicker exclude={[]} onAdd={addLine} onCancel={() => setAdding(false)} />
        ) : (
          <Button variant="outline" size="sm" className="min-h-11" onClick={() => setAdding(true)}>
            <Plus size={14} aria-hidden="true" /> Add a product
          </Button>
        ))}
    </div>
  );
}
