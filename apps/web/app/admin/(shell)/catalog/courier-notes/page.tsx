"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PackageX, Pencil, Plus, Trash2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { Table, TableCell, TableContainer, TableHead, TableHeaderCell, TableMessageRow, TableRow, TableSkeleton } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toast";
import { ModuleTabs } from "@/components/admin/module-tabs";
import { EmptyState } from "@/components/admin/empty-state";
import { PageHeader } from "@/components/admin/page-header";
import { useCanManageCatalog } from "@/hooks/use-can-manage-catalog";
import * as catalogApi from "@/lib/api/catalog";
import { describeApiError } from "@/lib/api-client";
import { cn, ICON_BUTTON_HIT } from "@/lib/utils";

const TEXT_MAX = 160;

interface Draft {
  name: string;
  text: string;
  trigger: "PRODUCT" | "DISCOUNT";
  minDiscountPercent: string;
  isActive: boolean;
  sortOrder: string;
}

const EMPTY_DRAFT: Draft = { name: "", text: "", trigger: "PRODUCT", minDiscountPercent: "40", isActive: true, sortOrder: "0" };

function appliesTo(rule: catalogApi.CourierNoteRuleRow) {
  if (rule.trigger === "DISCOUNT") return `Any order with an item ${rule.minDiscountPercent}%+ off`;
  const parts = [];
  if (rule.productCount) parts.push(`${rule.productCount} product${rule.productCount === 1 ? "" : "s"}`);
  if (rule.categoryCount) parts.push(`${rule.categoryCount} categor${rule.categoryCount === 1 ? "y" : "ies"}`);
  return parts.length ? parts.join(" · ") : "Not ticked on anything yet";
}

/** Catalog → Courier notes: the store's own instructions for the courier ("পারফিউম — প্যাকেট খোলা যাবে না"). Product rules are
 * ticked on products or categories; discount rules apply by themselves. When an order is booked, every rule that applies
 * is joined into the parcel note Steadfast prints for the rider, followed by the customer's own note. */
export default function CourierNotesPage() {
  const queryClient = useQueryClient();
  const canManage = useCanManageCatalog();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ["catalog-courier-notes"], queryFn: catalogApi.listCourierNoteRules });
  const rules = data?.rules ?? [];

  const [editing, setEditing] = useState<catalogApi.CourierNoteRuleRow | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [error, setError] = useState<string | null>(null);

  function openEditor(target: catalogApi.CourierNoteRuleRow | "new") {
    setError(null);
    setEditing(target);
    setDraft(
      target === "new"
        ? { ...EMPTY_DRAFT, sortOrder: String(rules.length) }
        : {
            name: target.name,
            text: target.text,
            trigger: target.trigger,
            minDiscountPercent: String(target.minDiscountPercent ?? 40),
            isActive: target.isActive,
            sortOrder: String(target.sortOrder),
          },
    );
  }

  const saveMutation = useMutation({
    mutationFn: () => {
      const input = {
        name: draft.name,
        text: draft.text,
        trigger: draft.trigger,
        minDiscountPercent: draft.trigger === "DISCOUNT" ? Number(draft.minDiscountPercent) : null,
        isActive: draft.isActive,
        sortOrder: Number(draft.sortOrder) || 0,
      };
      return editing && editing !== "new" ? catalogApi.updateCourierNoteRule(editing.id, input) : catalogApi.createCourierNoteRule(input);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["catalog-courier-notes"] });
      toast.success(editing === "new" ? "Courier note added" : "Courier note saved");
      setEditing(null);
    },
    onError: (err) => setError(describeApiError(err, "Failed to save courier note")),
  });

  async function handleDelete(rule: catalogApi.CourierNoteRuleRow) {
    const used = rule.productCount + rule.categoryCount;
    const message = used
      ? `Delete "${rule.name}"? It is ticked on ${appliesTo(rule)} and will be removed from them. Orders not yet booked stop sending it.`
      : `Delete "${rule.name}"?`;
    if (!(await confirm(message))) return;
    try {
      await catalogApi.deleteCourierNoteRule(rule.id);
      queryClient.invalidateQueries({ queryKey: ["catalog-courier-notes"] });
      toast.success("Courier note deleted");
    } catch (err) {
      toast.error(describeApiError(err, "Failed to delete courier note"));
    }
  }

  const percent = Number(draft.minDiscountPercent);
  const canSave =
    draft.name.trim().length > 0 &&
    draft.text.trim().length > 0 &&
    (draft.trigger === "PRODUCT" || (Number.isInteger(percent) && percent >= 1 && percent <= 99));

  return (
    <div>
      <PageHeader
        title="Courier notes"
        description="What the rider is told about a parcel, written once and applied by product, category or discount."
        action={
          canManage && (
            <Button variant="brass" onClick={() => openEditor("new")}>
              <Plus size={16} /> Add courier note
            </Button>
          )
        }
      />
      <ModuleTabs />

      <p className="mb-4 max-w-3xl text-sm text-ink-500">
        Instructions printed on the parcel for the courier&rsquo;s rider, e.g. <em>পারফিউম — প্যাকেট খোলা যাবে না</em>. Tick a note on a product
        (in the product editor&rsquo;s Pricing step) or a whole category, or make it apply to any order with a big discount. When an order is booked,
        every note that applies is sent together, followed by the customer&rsquo;s own note. Staff can still rewrite it on an order before booking.
      </p>

      {isError ? (
        <Alert
          variant="danger"
          title="Couldn't load courier notes"
          action={
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              Try again
            </Button>
          }
        >
          Check your connection and try again.
        </Alert>
      ) : (
        <TableContainer>
          <Table>
            <TableHead>
              <tr>
                <TableHeaderCell>Note</TableHeaderCell>
                <TableHeaderCell>Courier sees</TableHeaderCell>
                <TableHeaderCell>Applies to</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                {canManage && <TableHeaderCell align="right">Actions</TableHeaderCell>}
              </tr>
            </TableHead>
            <tbody>
              {isLoading && <TableSkeleton rows={3} cols={canManage ? 5 : 4} />}
              {!isLoading && rules.length === 0 && (
                <TableMessageRow colSpan={canManage ? 5 : 4}>
                  <EmptyState
                    icon={PackageX}
                    title="No courier notes yet"
                    description="Add one like “Perfume — packet khola jabe na”, then tick it on the products it’s for."
                  />
                </TableMessageRow>
              )}
              {rules.map((rule) => (
                <TableRow key={rule.id} interactive className={cn(!rule.isActive && "opacity-60")}>
                  <TableCell className="whitespace-nowrap font-medium text-ink-900">{rule.name}</TableCell>
                  <TableCell className="min-w-[12rem] max-w-xs text-ink-700" lang="bn">
                    {rule.text}
                  </TableCell>
                  <TableCell className="min-w-[10rem] text-ink-600">
                    <span className="block">{appliesTo(rule)}</span>
                    {rule.trigger === "DISCOUNT" && <span className="text-xs text-ink-400">Off the compare-at price, incl. flash sale and coupon</span>}
                  </TableCell>
                  <TableCell>{rule.isActive ? <Badge variant="success">Active</Badge> : <Badge>Off</Badge>}</TableCell>
                  {canManage && (
                    <TableCell>
                      <div className="flex justify-end gap-3">
                        <button onClick={() => openEditor(rule)} className={cn(ICON_BUTTON_HIT, "text-ink-500 hover:text-ink-900")} aria-label={`Edit ${rule.name}`}>
                          <Pencil size={16} />
                        </button>
                        <button onClick={() => handleDelete(rule)} className={cn(ICON_BUTTON_HIT, "text-ink-500 hover:text-danger-600")} aria-label={`Delete ${rule.name}`}>
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </tbody>
          </Table>
        </TableContainer>
      )}
      {!canManage && <p className="mt-3 text-xs text-ink-400">Only the store owner can change courier notes.</p>}

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "Add courier note" : "Edit courier note"} widthClassName="max-w-lg">
        {error && <p className="mb-3 text-sm text-danger-600">{error}</p>}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            saveMutation.mutate();
          }}
          className="space-y-4"
        >
          <div>
            <Label htmlFor="cn-name">Name</Label>
            <Input id="cn-name" value={draft.name} maxLength={60} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Perfume" />
            <p className="mt-1 text-xs text-ink-500">Only staff see this — it labels the checkbox on products.</p>
          </div>
          <div>
            <Label htmlFor="cn-text">What the courier sees</Label>
            <Textarea
              id="cn-text"
              lang="bn"
              rows={2}
              maxLength={TEXT_MAX}
              value={draft.text}
              onChange={(e) => setDraft({ ...draft, text: e.target.value })}
              placeholder="পারফিউম — প্যাকেট খোলা যাবে না"
            />
            <p className="mt-1 text-xs text-ink-500">
              Keep it short; the rider reads it on the parcel. {draft.text.length}/{TEXT_MAX}
            </p>
          </div>
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium text-ink-800">When it applies</legend>
            <div className="space-y-2">
              <label className="flex items-start gap-2 text-sm text-ink-700">
                <input
                  type="radio"
                  name="cn-trigger"
                  className="mt-1"
                  checked={draft.trigger === "PRODUCT"}
                  onChange={() => setDraft({ ...draft, trigger: "PRODUCT" })}
                />
                <span>
                  Products I tick it on
                  <span className="block text-xs text-ink-500">On the product, or on a category for all its products.</span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm text-ink-700">
                <input
                  type="radio"
                  name="cn-trigger"
                  className="mt-1"
                  checked={draft.trigger === "DISCOUNT"}
                  onChange={() => setDraft({ ...draft, trigger: "DISCOUNT" })}
                />
                <span>
                  Any order with a big discount
                  <span className="block text-xs text-ink-500">Automatic — no ticking needed.</span>
                </span>
              </label>
            </div>
            {draft.trigger === "DISCOUNT" && (
              <div className="mt-3 pl-6">
                <Label htmlFor="cn-percent">An item is at least this much off</Label>
                <div className="flex max-w-[10rem] items-center gap-2">
                  <Input
                    id="cn-percent"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={99}
                    value={draft.minDiscountPercent}
                    onChange={(e) => setDraft({ ...draft, minDiscountPercent: e.target.value })}
                  />
                  <span className="text-sm text-ink-600">%</span>
                </div>
                <p className="mt-1 text-xs text-ink-500">Measured from the compare-at (&ldquo;was&rdquo;) price to what the customer paid, after flash sale, bundle and coupon.</p>
              </div>
            )}
          </fieldset>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="cn-order">Order in the note</Label>
              <Input id="cn-order" type="number" inputMode="numeric" min={0} max={1000} value={draft.sortOrder} onChange={(e) => setDraft({ ...draft, sortOrder: e.target.value })} />
              <p className="mt-1 text-xs text-ink-500">Lower comes first.</p>
            </div>
            <label className="flex items-center gap-2 self-center text-sm text-ink-700">
              <Checkbox checked={draft.isActive} onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })} />
              Active
            </label>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button type="submit" variant="brass" disabled={saveMutation.isPending || !canSave}>
              {saveMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </Modal>
      {confirmDialog}
    </div>
  );
}
