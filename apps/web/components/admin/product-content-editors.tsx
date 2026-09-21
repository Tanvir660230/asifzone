"use client";

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { RELATION_SECTIONS } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ProductPicker } from "@/components/admin/product-picker";

export interface FaqRow {
  question: string;
  answer: string;
}

/** The product's own questions and answers: add, edit, reorder, delete. */
export function FaqEditor({ value, onChange }: { value: FaqRow[]; onChange: (rows: FaqRow[]) => void }) {
  const update = (i: number, patch: Partial<FaqRow>) => onChange(value.map((r, ri) => (ri === i ? { ...r, ...patch } : r)));
  const move = (i: number, delta: number) => {
    const j = i + delta;
    if (j < 0 || j >= value.length) return;
    const next = [...value];
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };

  return (
    <div className="space-y-3" data-testid="faq-editor">
      {value.length === 0 && <p className="text-sm text-ink-400">No questions yet. Answering the things customers ask most (sizing, fabric, delivery) reduces support messages.</p>}
      {value.map((row, i) => (
        <div key={i} className="rounded-lg border border-ink-100 p-3">
          <div className="flex items-start gap-2">
            <div className="flex flex-col">
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="text-ink-400 hover:text-ink-900 disabled:opacity-25" aria-label={`Move question ${i + 1} up`}>
                <ArrowUp size={14} />
              </button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === value.length - 1} className="text-ink-400 hover:text-ink-900 disabled:opacity-25" aria-label={`Move question ${i + 1} down`}>
                <ArrowDown size={14} />
              </button>
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <Input value={row.question} onChange={(e) => update(i, { question: e.target.value })} placeholder="Question" maxLength={200} aria-label={`Question ${i + 1}`} />
              <Textarea value={row.answer} onChange={(e) => update(i, { answer: e.target.value })} placeholder="Answer" rows={2} maxLength={2000} aria-label={`Answer ${i + 1}`} />
            </div>
            <button type="button" onClick={() => onChange(value.filter((_, ri) => ri !== i))} className="p-1 text-ink-400 hover:text-danger-600" aria-label={`Delete question ${i + 1}`}>
              <Trash2 size={16} />
            </button>
          </div>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" disabled={value.length >= 30} onClick={() => onChange([...value, { question: "", answer: "" }])}>
        <Plus size={14} /> Add question
      </Button>
    </div>
  );
}

export interface RelationRow {
  kind: string;
  productIds: string[];
}

/** Hand-pick the products for each recommendation list. Empty = the store's automatic list, so nothing has to be filled in. */
export function RelatedProductsEditor({
  value,
  names,
  onChange,
  onNames,
}: {
  value: RelationRow[];
  /** id → name for every picked product (the API returns names for saved picks; new picks add theirs). */
  names: Record<string, string>;
  onChange: (rows: RelationRow[]) => void;
  onNames: (added: Record<string, string>) => void;
}) {
  const idsFor = (kind: string) => value.find((r) => r.kind === kind)?.productIds ?? [];
  const setKind = (kind: string, productIds: string[]) =>
    onChange([...value.filter((r) => r.kind !== kind), ...(productIds.length ? [{ kind, productIds }] : [{ kind, productIds: [] }])]);

  return (
    <div className="space-y-5" data-testid="related-editor">
      {RELATION_SECTIONS.map((section) => {
        const ids = idsFor(section.relationKind);
        return (
          <div key={section.key}>
            <p className="text-sm font-medium text-ink-900">{section.label}</p>
            <p className="mb-2 text-xs text-ink-400">
              {ids.length === 0 ? "Using the automatic list. " : `${ids.length} hand-picked (max 12). `}
              {section.help}
            </p>
            <ProductPicker
              selected={ids.map((id) => ({ id, name: names[id] ?? id }))}
              onChange={(selected) => {
                onNames(Object.fromEntries(selected.map((p) => [p.id, p.name])));
                setKind(section.relationKind, selected.slice(0, 12).map((p) => p.id));
              }}
            />
          </div>
        );
      })}
    </div>
  );
}
