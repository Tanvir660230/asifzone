"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import * as catalogApi from "@/lib/api/catalog";

/** Ticks the store's courier notes (Catalog → Courier notes) on a product or a category. Notes the product already
 * gets from its category show ticked and locked; discount notes are listed as automatic. */
export function CourierNotePicker({
  value,
  onChange,
  inherited = [],
  inheritedFrom = "its category",
  idPrefix = "courier-note",
}: {
  value: string[];
  onChange: (ids: string[]) => void;
  /** Rule ids that already apply through the category chain. */
  inherited?: string[];
  inheritedFrom?: string;
  idPrefix?: string;
}) {
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ["catalog-courier-notes"], queryFn: catalogApi.listCourierNoteRules, staleTime: 60_000 });

  if (isLoading) {
    return (
      <div className="space-y-2" aria-busy="true">
        <div className="ui-skeleton h-5 w-56 rounded" />
        <div className="ui-skeleton h-5 w-48 rounded" />
      </div>
    );
  }
  if (isError || !data) {
    return (
      <p className="text-sm text-danger-600">
        Couldn&rsquo;t load courier notes.{" "}
        <button type="button" className="underline" onClick={() => refetch()}>
          Try again
        </button>
      </p>
    );
  }

  // A switched-off rule stays visible only where it's already ticked, so it can be unticked.
  const productRules = data.rules.filter((r) => r.trigger === "PRODUCT" && (r.isActive || value.includes(r.id)));
  const discountRules = data.rules.filter((r) => r.trigger === "DISCOUNT" && r.isActive);
  const inheritedSet = new Set(inherited);

  if (!productRules.length && !discountRules.length) {
    return (
      <p className="text-sm text-fg-muted">
        No courier notes yet.{" "}
        <Link href="/admin/catalog/courier-notes" className="font-medium text-fg underline">
          Create one
        </Link>{" "}
        (e.g. &ldquo;পারফিউম — প্যাকেট খোলা যাবে না&rdquo;) and tick it here.
      </p>
    );
  }

  const toggle = (id: string, checked: boolean) => onChange(checked ? [...new Set([...value, id])] : value.filter((v) => v !== id));

  return (
    <div className="space-y-3">
      {productRules.length > 0 && (
        <ul className="space-y-2.5">
          {productRules.map((rule) => {
            const fromCategory = inheritedSet.has(rule.id);
            const id = `${idPrefix}-${rule.id}`;
            return (
              <li key={rule.id}>
                <label htmlFor={id} className="flex items-start gap-2.5 text-sm text-ink-700">
                  <Checkbox
                    id={id}
                    className="mt-0.5"
                    checked={fromCategory || value.includes(rule.id)}
                    disabled={fromCategory}
                    onChange={(e) => toggle(rule.id, e.target.checked)}
                  />
                  <span className="min-w-0">
                    <span className="font-medium text-fg">{rule.name}</span>
                    {fromCategory && <span className="ml-1.5 text-xs text-fg-muted">from {inheritedFrom}</span>}
                    {!rule.isActive && (
                      <Badge className="ml-1.5" variant="neutral">
                        Off
                      </Badge>
                    )}
                    <span className="block text-xs text-fg-muted" lang="bn">
                      Courier sees: {rule.text}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
      {discountRules.length > 0 && (
        <p className="text-xs text-fg-muted">
          Automatic:{" "}
          {discountRules.map((r, i) => (
            <span key={r.id}>
              {i > 0 && "; "}
              <span lang="bn">{r.text}</span> when an item is {r.minDiscountPercent}%+ off
            </span>
          ))}
          .
        </p>
      )}
      <p className="text-xs text-fg-muted">
        Sent to the courier when an order is booked.{" "}
        <Link href="/admin/catalog/courier-notes" className="underline">
          Manage courier notes
        </Link>
      </p>
    </div>
  );
}

/** Rule ids a category and every category above it carry. */
export function inheritedCourierNoteIds(categoryId: string | null | undefined, categories: { id: string; parentId: string | null; courierNoteRuleIds?: string[] }[]) {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const ids: string[] = [];
  const seen = new Set<string>();
  let current = categoryId ?? null;
  while (current && !seen.has(current)) {
    seen.add(current);
    const node = byId.get(current);
    if (!node) break;
    ids.push(...(node.courierNoteRuleIds ?? []));
    current = node.parentId;
  }
  return ids;
}
